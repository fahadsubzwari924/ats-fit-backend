import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '../../../exceptions/custom-http-exceptions';
import {
  ClaudeRequestParams,
  ClaudeResponse,
  ClaudeAtsEvaluationParams,
} from '../interfaces';
import { AIErrorUtil } from '../../../utils/ai-error.util';

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

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    this.baseUrl = this.configService.get<string>('CLAUDE_CHAT_API_ENDPOINT');
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

    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        this.activeRequests++;
        const response = await this.makeClaudeRequest(params);
        this.activeRequests--;
        this.processQueue();
        return response;
      } catch (error) {
        this.activeRequests--;
        this.processQueue();

        // Check if it's an overload error - skip retries and fail fast
        if (AIErrorUtil.isClaudeOverloadError(error)) {
          this.logger.warn(
            'Claude API overloaded (529), skipping retries and failing fast for immediate fallback',
          );
          throw new InternalServerErrorException(
            'Claude API overloaded - immediate fallback required',
          );
        }

        attempt++;
        if (attempt === maxRetries) {
          this.logger.error(
            `Claude API failed after ${maxRetries} attempts`,
            error,
          );
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

    // Optimize request body for better performance
    const requestBody: any = {
      model: params.model || 'claude-3-5-sonnet-20241022',
      messages: params.messages,
      max_tokens: params.max_tokens || 4000,
      temperature: params.temperature || 0.1,
    };

    // Add system parameter for better performance if not present
    const hasSystemMessage = params.messages.some(
      (msg) =>
        typeof msg === 'object' &&
        'role' in msg &&
        (msg as { role?: string }).role === 'system',
    );
    if (!hasSystemMessage) {
      (requestBody as { system?: string }).system =
        'You are a helpful AI assistant. Provide concise, accurate responses in the requested format.';
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
      function isClaudeApiResponse(
        data: unknown,
      ): data is { content: Array<{ text: string }> } {
        if (
          typeof data === 'object' &&
          data !== null &&
          Object.prototype.hasOwnProperty.call(data, 'content')
        ) {
          const content = (data as { content?: unknown }).content;
          return (
            Array.isArray(content) &&
            content.length > 0 &&
            typeof content[0] === 'object' &&
            content[0] !== null &&
            'text' in content[0] &&
            typeof (content[0] as { text?: unknown }).text === 'string'
          );
        }
        return false;
      }
      if (isClaudeApiResponse(data)) {
        content = data.content[0].text;
      }

      return {
        choices: [
          {
            message: {
              content,
            },
          },
        ],
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

  // Specialized method for ATS evaluation with optimized prompt
  async evaluateAtsMatch(params: ClaudeAtsEvaluationParams): Promise<any> {
    try {
      this.logger.log('Starting Claude ATS evaluation...');

      // Optimize the prompt for faster processing
      const optimizedPrompt = this.optimizeAtsPrompt(params.prompt);

      const result = await this.chatCompletion({
        model: 'claude-3-5-sonnet-20241022',
        messages: [{ role: 'user', content: optimizedPrompt }],
        temperature: 0.1, // Low temperature for consistent scoring
        max_tokens: 3000, // Reduced for faster response
      });

      const content = result.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('No content in Claude ATS evaluation response');
      }

      this.logger.log('Claude ATS evaluation completed successfully');
      return JSON.parse(content);
    } catch (error) {
      this.logger.error('Claude ATS evaluation failed', error);

      // Check if it's an overload error - re-throw as-is to preserve the error type
      if (AIErrorUtil.isClaudeOverloadError(error)) {
        this.logger.warn(
          'Claude ATS evaluation failed due to overload - re-throwing for fallback handling',
        );
        throw error;
      }

      // Provide more specific error information for other errors
      if (error instanceof Error) {
        if (error.message.includes('response_format')) {
          throw new InternalServerErrorException(
            'Claude API response format error - please check API configuration',
          );
        }
        if (error.message.includes('401')) {
          throw new InternalServerErrorException(
            'Claude API authentication failed - please check API key',
          );
        }
        if (error.message.includes('429')) {
          throw new InternalServerErrorException(
            'Claude API rate limit exceeded - please try again later',
          );
        }
        if (error.message.includes('AbortError')) {
          throw new InternalServerErrorException(
            'Claude API request timed out - please try again',
          );
        }
      }

      throw new InternalServerErrorException(
        'Failed to evaluate ATS match with Claude',
      );
    }
  }

  private optimizeAtsPrompt(prompt: string): string {
    // Optimize the prompt for faster processing
    return prompt
      .replace(/\n\s*\n/g, '\n') // Remove extra blank lines
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }
}
