import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '../../../exceptions/custom-http-exceptions';
import { ClaudeRequestParams, ClaudeResponse } from '../interfaces';
import { AIErrorUtil } from '../../../utils/ai-error.util';
import { LlmTelemetryService } from '../../../services/llm-telemetry.service';

@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxConcurrentRequests: number;
  private readonly requestTimeout: number;
  private activeRequests = 0;
  private requestQueue: Array<{
    params: ClaudeRequestParams;
    resolve: (value: ClaudeResponse) => void;
    reject: (reason: any) => void;
  }> = [];

  /** Default model resolved once at startup from env; callers may override per-request. */
  readonly defaultModel: string;

  constructor(
    private configService: ConfigService,
    private readonly telemetryService: LlmTelemetryService,
  ) {
    this.apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.baseUrl = this.configService.get<string>('CLAUDE_CHAT_API_ENDPOINT');
    this.defaultModel = this.configService.get<string>(
      'CLAUDE_MODEL',
      'claude-sonnet-4-20250514',
    );
    this.maxConcurrentRequests = this.configService.get<number>(
      'CLAUDE_MAX_CONCURRENT',
      5,
    );
    // Configure timeout - default to 60 seconds for complex resume optimization
    this.requestTimeout = this.configService.get<number>(
      'CLAUDE_REQUEST_TIMEOUT',
      60000, // 60 seconds
    );

    if (!this.apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not found in environment variables');
    }
  }

  async chatCompletion(params: ClaudeRequestParams): Promise<ClaudeResponse> {
    const maxRetries = this.configService.get<number>('CLAUDE_MAX_RETRIES', 3);
    const initialDelay = this.configService.get<number>(
      'CLAUDE_RETRY_DELAY',
      1000,
    );

    // Check if we can process immediately or need to queue
    if (this.activeRequests >= this.maxConcurrentRequests) {
      return new Promise((resolve, reject) => {
        this.requestQueue.push({ params, resolve, reject });
      });
    }

    const callStart = Date.now();
    let attempt = 0;
    let retryCount = 0;
    while (attempt < maxRetries) {
      try {
        this.activeRequests++;
        const response = await this.makeClaudeRequest(params);
        this.activeRequests--;
        this.processQueue();

        this.telemetryService.record({
          prompt_id: params.promptId ?? 'unknown',
          prompt_version: params.promptVersion ?? 'unknown',
          model: params.model ?? this.defaultModel,
          input_tokens: response.usage?.input_tokens ?? 0,
          output_tokens: response.usage?.output_tokens ?? 0,
          cache_read_input_tokens: response.usage?.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens:
            response.usage?.cache_creation_input_tokens ?? 0,
          latency_ms: Date.now() - callStart,
          retry_count: retryCount,
          parse_outcome: 'success',
          fallback_triggered: false,
        });

        return response;
      } catch (error) {
        this.activeRequests--;
        this.processQueue();

        // Check if it's an overload error - skip retries and fail fast
        if (AIErrorUtil.isClaudeOverloadError(error)) {
          this.logger.warn(
            'Claude API overloaded (529), skipping retries and failing fast for immediate fallback',
          );
          this.telemetryService.record({
            prompt_id: params.promptId ?? 'unknown',
            prompt_version: params.promptVersion ?? 'unknown',
            model: params.model ?? this.defaultModel,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            latency_ms: Date.now() - callStart,
            retry_count: retryCount,
            parse_outcome: 'failure',
            fallback_triggered: false,
          });
          throw new InternalServerErrorException(
            'Claude API overloaded - immediate fallback required',
          );
        }

        attempt++;
        retryCount++;
        if (attempt === maxRetries) {
          this.logger.error(
            `Claude API failed after ${maxRetries} attempts`,
            error,
          );
          this.telemetryService.record({
            prompt_id: params.promptId ?? 'unknown',
            prompt_version: params.promptVersion ?? 'unknown',
            model: params.model ?? this.defaultModel,
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            latency_ms: Date.now() - callStart,
            retry_count: retryCount,
            parse_outcome: 'failure',
            fallback_triggered: false,
          });
          throw new InternalServerErrorException(
            'Claude API failed after maximum retries',
          );
        }
        const delay = initialDelay * Math.pow(2, attempt);
        this.logger.warn(
          `Claude API failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new InternalServerErrorException('Unexpected error in retry logic');
  }

  private processQueue(): void {
    if (
      this.requestQueue.length > 0 &&
      this.activeRequests < this.maxConcurrentRequests
    ) {
      const request = this.requestQueue.shift();
      if (request) {
        this.chatCompletion(request.params)
          .then(request.resolve)
          .catch(request.reject);
      }
    }
  }

  private async makeClaudeRequest(
    params: ClaudeRequestParams,
  ): Promise<ClaudeResponse> {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required for Claude API calls');
    }

    interface AnthropicRequestBody {
      model: string;
      messages: ClaudeRequestParams['messages'];
      max_tokens: number;
      temperature: number;
      system?:
        | string
        | Array<{
            type: 'text';
            text: string;
            cache_control?: { type: 'ephemeral' };
          }>;
      tools?: Array<{
        name: string;
        description: string;
        input_schema: Record<string, unknown>;
      }>;
      tool_choice?: { type: 'tool'; name: string };
      thinking?: { type: 'enabled'; budget_tokens: number };
      betas?: string[];
    }

    // Optimize request body for better performance
    const requestBody: AnthropicRequestBody = {
      model: params.model || this.defaultModel,
      messages: params.messages,
      max_tokens: params.max_tokens || 4000,
      temperature: params.temperature || 0.1,
    };

    if (params.system) {
      requestBody.system = params.system;
    } else {
      // Fallback default for callers that don't pass a structured system block
      requestBody.system =
        'You are a helpful AI assistant. Provide concise, accurate responses in the requested format.';
    }

    if (params.tools) requestBody.tools = params.tools;
    if (params.tool_choice) requestBody.tool_choice = params.tool_choice;
    if (params.thinking) {
      requestBody.thinking = params.thinking;
    }

    const startTime = Date.now();
    this.logger.debug(`Claude API request started at ${startTime}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.requestTimeout,
      );

      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': params.thinking
            ? 'prompt-caching-2024-07-31,interleaved-thinking-2025-05-14'
            : 'prompt-caching-2024-07-31',
          'User-Agent': 'ATS-Fit-Backend/1.0',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `Claude API error: ${response.status} - ${errorText}`,
        );
        throw new Error(`Claude API error: ${response.status} - ${errorText}`);
      }

      const data: unknown = await response.json();

      this.logger.debug(
        `Claude API request completed in ${Date.now() - startTime}ms`,
      );

      // Transform Claude response to match OpenAI format for compatibility
      let content = '';

      const rawData = data as {
        content?: Array<{ type?: string; text?: string; input?: unknown }>;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
        stop_reason?: string;
      };

      // Handle tool_use response blocks first, then fall back to text blocks
      const toolBlock = rawData.content?.find((c) => c.type === 'tool_use');
      if (toolBlock?.input !== undefined && toolBlock.input !== null) {
        content = JSON.stringify(toolBlock.input);
      } else if (rawData.content?.[0]?.type === 'text') {
        content = rawData.content[0].text ?? '';
      }

      let usage: ClaudeResponse['usage'];
      if (rawData.usage) {
        usage = {
          input_tokens: rawData.usage.input_tokens ?? 0,
          output_tokens: rawData.usage.output_tokens ?? 0,
          cache_read_input_tokens: rawData.usage.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens:
            rawData.usage.cache_creation_input_tokens ?? 0,
        };
      }

      return {
        choices: [
          {
            message: {
              content,
            },
            finish_reason: rawData.stop_reason,
          },
        ],
        usage,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;

      // Provide specific error messages for different timeout scenarios
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.error(
          `Claude API request timed out after ${processingTime}ms (limit: ${this.requestTimeout}ms)`,
        );
        throw new Error(
          `Claude API request timed out after ${this.requestTimeout / 1000}s. Consider increasing CLAUDE_REQUEST_TIMEOUT or reducing request complexity.`,
        );
      }

      this.logger.error(
        `Claude API request failed after ${processingTime}ms`,
        error,
      );
      throw error;
    }
  }
}
