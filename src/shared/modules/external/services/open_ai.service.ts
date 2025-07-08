// openai.service.ts
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ConfigService } from '@nestjs/config';
import { head } from 'lodash';
import { InternalServerErrorException } from '../../../exceptions/custom-http-exceptions';

interface OpenApiRequestParams {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  response_format?: { type: 'json_object' | 'text' };
  temperature?: number;
  max_tokens?: number;
}

@Injectable()
export class OpenAIService {
  private readonly logger = new Logger(OpenAIService.name);
  private openai: OpenAI;

  constructor(private configService: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('OPENAI_API_KEY'),
    });
  }

  async chatCompletion(params: OpenApiRequestParams) {
    // try {
    //   const completion = await this.openai.chat.completions.create({
    //     model: params.model || 'gpt-4',
    //     messages: params.messages,
    //     response_format: params.response_format,
    //     temperature: params.temperature || 0.7, // Balanced creativity
    //     max_tokens: params.max_tokens || 2000,
    //   });

    //   return completion;
    // } catch (error) {
    //   this.logger.error('OpenAI API Error', error);
    //   throw new Error('Failed to generate AI response');
    // }

    const maxRetries = this.configService.get<number>('OPENAI_MAX_RETRIES');
    const initialDelay = this.configService.get<number>('OPENAI_RETRY_DELAY');

    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        const response = await this.makeOpenAiRequest(params);
        return response;
      } catch (error) {
        attempt++;
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
      response_format: params.response_format,
      temperature: params.temperature || 0.7, // Balanced creativity
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
