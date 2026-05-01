// openai.service.ts
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { head } from 'lodash';
import { InternalServerErrorException } from '../../../exceptions/custom-http-exceptions';
import { LlmTelemetryService } from '../../../services/llm-telemetry.service';

type OpenApiResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        strict: boolean;
        schema: Record<string, unknown>;
      };
    };

interface OpenApiRequestParams {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  response_format?: OpenApiResponseFormat;
  temperature?: number;
  max_tokens?: number;
  promptId?: string;
  promptVersion?: string;
  fallback_triggered?: boolean;
}

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private openai: OpenAI;

  constructor(
    private configService: ConfigService,
    private readonly telemetryService: LlmTelemetryService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
  }

  async chatCompletion(params: OpenApiRequestParams) {
    const maxRetries = this.configService.get<number>('OPENAI_MAX_RETRIES', 3);
    const initialDelay = this.configService.get<number>(
      'OPENAI_RETRY_DELAY',
      1000,
    );

    const callStart = Date.now();
    let attempt = 0;
    let retryCount = 0;
    while (attempt < maxRetries) {
      try {
        const response = await this.makeOpenAiRequest(params);

        this.telemetryService.record({
          prompt_id: params.promptId ?? 'unknown',
          prompt_version: params.promptVersion ?? 'unknown',
          model: params.model,
          input_tokens: response.usage?.prompt_tokens ?? 0,
          output_tokens: response.usage?.completion_tokens ?? 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          latency_ms: Date.now() - callStart,
          retry_count: retryCount,
          parse_outcome: 'success',
          fallback_triggered: params.fallback_triggered ?? false,
        });

        return response;
      } catch (error) {
        attempt++;
        retryCount++;
        if (attempt === maxRetries) {
          this.logger.error(
            `Open AI API failed after ${maxRetries} attempts`,
            error,
          );
          throw new InternalServerErrorException(
            'Open AI API failed after maximum retries',
          );
        }
        const delay = initialDelay * Math.pow(2, attempt);
        this.logger.warn(
          `Open AI API failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new InternalServerErrorException('Unexpected error in retry logic');
  }

  async makeOpenAiRequest(params: OpenApiRequestParams) {
    const completion = await this.openai.chat.completions.create({
      model: params.model || 'gpt-4',
      messages: params.messages,
      // Cast to OpenAI SDK union type — our internal discriminated union is structurally
      // compatible; the cast is safe because callers always provide json_schema when
      // type === 'json_schema' (enforced by OpenApiResponseFormat).
      response_format: params.response_format as
        | OpenAI.ResponseFormatText
        | OpenAI.ResponseFormatJSONSchema
        | OpenAI.ResponseFormatJSONObject
        | undefined,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens || 2000,
    });

    return completion;
  }

  async getEmbeddings(
    input: string | string[],
    model: string = 'text-embedding-3-small',
  ): Promise<number[] | number[][]> {
    try {
      const response = await this.openai.embeddings.create({
        model,
        input: input,
      });

      if (typeof input === 'string') {
        return head(response.data).embedding;
      }
      return response.data.map((item) => item.embedding);
    } catch (error) {
      this.logger.error('OpenAI Embeddings Error', error);
      throw new Error('Failed to generate embeddings');
    }
  }

  // Alternative: Create separate methods for better type safety
  async getSingleEmbedding(
    text: string,
    model: string = 'text-embedding-3-small',
  ): Promise<number[]> {
    try {
      const response = await this.openai.embeddings.create({
        model,
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      this.logger.error('OpenAI Single Embedding Error', error);
      throw new Error('Failed to generate single embedding');
    }
  }

  async getMultipleEmbeddings(
    texts: string[],
    model: string = 'text-embedding-3-small',
  ): Promise<number[][]> {
    try {
      const response = await this.openai.embeddings.create({
        model,
        input: texts,
      });

      return response.data.map((item) => item.embedding);
    } catch (error) {
      this.logger.error('OpenAI Multiple Embeddings Error', error);
      throw new Error('Failed to generate multiple embeddings');
    }
  }
}
