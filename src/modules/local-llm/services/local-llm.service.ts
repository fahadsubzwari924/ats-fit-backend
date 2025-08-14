import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Agent } from 'http';
import { InternalServerErrorException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  repeatPenalty?: number;
  stopSequences?: string[];
}

export interface JsonCompletionOptions extends CompletionOptions {
  format?: 'json';
  maxRetries?: number;
}

interface OllamaRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  format?: 'json';
  options?: {
    temperature?: number;
    top_p?: number;
    num_predict?: number;
    repeat_penalty?: number;
    stop?: string[];
  };
}

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaTagsResponse {
  models: Array<{
    name: string;
    model: string;
    modified_at: string;
    size: number;
    digest: string;
    details: {
      parent_model: string;
      format: string;
      family: string;
      families: string[];
      parameter_size: string;
      quantization_level: string;
    };
  }>;
}

@Injectable()
export class LocalLlmService implements OnModuleDestroy {
  private readonly logger = new Logger(LocalLlmService.name);
  private readonly OLLAMA_BASE_URL: string;
  private readonly MODEL_NAME: string;
  private readonly REQUEST_TIMEOUT = 120000; // 2 minutes
  private readonly httpAgent: Agent;

  constructor(private readonly configService: ConfigService) {
    this.OLLAMA_BASE_URL = this.configService.get<string>(
      'LOCAL_LLM_OLLAMA_URL',
      'http://localhost:11434',
    );

    this.MODEL_NAME = this.configService.get<string>(
      'LOCAL_LLM_MODEL_NAME',
      'llama3',
    );

    // Create reusable HTTP agent with keep-alive
    this.httpAgent = new Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      timeout: this.REQUEST_TIMEOUT,
      maxSockets: 10,
    });
  }

  /**
   * Generate completion using local Ollama instance
   */
  async generateCompletion(
    prompt: string,
    options?: CompletionOptions,
  ): Promise<string> {
    const startTime = Date.now();

    try {
      const request: OllamaRequest = {
        model: this.MODEL_NAME,
        prompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          top_p: options?.topP ?? 0.9,
          num_predict: options?.maxTokens ?? 4000,
          repeat_penalty: options?.repeatPenalty ?? 1.1,
          ...(options?.stopSequences && { stop: options.stopSequences }),
        },
      };

      this.logger.debug(
        `Sending request to Ollama with model ${this.MODEL_NAME}`,
        {
          promptLength: prompt.length,
          temperature: request.options?.temperature,
          maxTokens: request.options?.num_predict,
        },
      );

      const response = await axios.post<OllamaResponse>(
        `${this.OLLAMA_BASE_URL}/api/generate`,
        request,
        {
          timeout: this.REQUEST_TIMEOUT,
          headers: {
            'Content-Type': 'application/json',
          },
          httpAgent: this.httpAgent,
        },
      );

      const duration = Date.now() - startTime;
      this.logger.log(`Ollama request completed in ${duration}ms`);

      if (!response.data?.response) {
        throw new InternalServerErrorException(
          'Invalid response from local LLM',
          ERROR_CODES.INTERNAL_SERVER,
        );
      }

      const cleanResponse = response.data.response.trim();

      // Log completion status
      this.logger.debug('Response status:', {
        done: response.data.done,
        responseLength: cleanResponse.length,
        duration,
      });

      return cleanResponse;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Ollama request failed after ${duration}ms`, error);

      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          throw new InternalServerErrorException(
            'Local LLM service is not available. Please ensure Ollama is running.',
            ERROR_CODES.INTERNAL_SERVER,
          );
        }
        if (error.code === 'ETIMEDOUT') {
          throw new InternalServerErrorException(
            'Local LLM request timed out',
            ERROR_CODES.INTERNAL_SERVER,
          );
        }
        if (
          error.code === 'ECONNRESET' ||
          error.message.includes('socket hang up')
        ) {
          throw new InternalServerErrorException(
            'Connection to Ollama was reset. The model may be overloaded.',
            ERROR_CODES.INTERNAL_SERVER,
          );
        }
      }

      throw new InternalServerErrorException(
        'Failed to generate completion from local LLM',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Generate JSON completion with retries and validation
   */
  async generateJsonCompletion(
    prompt: string,
    options?: JsonCompletionOptions,
  ): Promise<unknown> {
    const maxRetries = options?.maxRetries ?? 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.debug(`JSON completion attempt ${attempt}/${maxRetries}`);

        // Use format: 'json' for better JSON compliance
        const response = await this.generateCompletion(prompt, {
          temperature: options?.temperature ?? 0.1,
          maxTokens: options?.maxTokens ?? 4000,
          topP: options?.topP ?? 0.9,
          repeatPenalty: options?.repeatPenalty ?? 1.1,
          stopSequences: options?.stopSequences,
        });

        this.logger.log(`Ollama response: ${response}`);

        // Extract and validate JSON
        const jsonResponse = this.extractJsonFromResponse(response);
        this.logger.log(`jsonResponse: ${jsonResponse}`);
        if (!jsonResponse) {
          throw new Error(
            `No valid JSON found in response: ${response.substring(0, 200)}...`,
          );
        }

        // Parse to validate JSON structure
        const parsedResponse: unknown = JSON.parse(jsonResponse);

        this.logger.log(`JSON completion successful on attempt ${attempt}`);
        return parsedResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `JSON completion attempt ${attempt} failed:`,
          lastError.message,
        );

        if (attempt === maxRetries) {
          break;
        }

        // Wait before retry with exponential backoff
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }

    this.logger.error(`All JSON completion attempts failed`, lastError);
    throw new InternalServerErrorException(
      'Failed to generate valid JSON response from local LLM',
      ERROR_CODES.INTERNAL_SERVER,
    );
  }

  /**
   * Extract clean JSON from response that might contain extra text
   */
  private extractJsonFromResponse(response: string): string | null {
    try {
      // Trim and clean the response
      const cleaned = response.trim();

      // Check if the response starts with a JSON object or array
      if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
        // Validate and return the JSON directly
        JSON.parse(cleaned);
        return cleaned;
      }

      // Attempt to locate the first JSON object in the response
      const openBraceIndex = cleaned.indexOf('{');
      if (openBraceIndex !== -1) {
        const jsonCandidate = this.extractJsonObject(cleaned, openBraceIndex);
        if (jsonCandidate) {
          return jsonCandidate;
        }
      }

      // Attempt to locate the first JSON array in the response
      const openBracketIndex = cleaned.indexOf('[');
      if (openBracketIndex !== -1) {
        const jsonCandidate = this.extractJsonArray(cleaned, openBracketIndex);
        if (jsonCandidate) {
          return jsonCandidate;
        }
      }

      // If no valid JSON is found, log the issue and return null
      this.logger.warn('No valid JSON found in response', {
        responsePreview: cleaned.substring(0, 200),
      });
      return null;
    } catch (error) {
      this.logger.error('Failed to extract JSON from response', {
        error: error instanceof Error ? error.message : String(error),
        responsePreview: response.substring(0, 200),
      });
      return null;
    }
  }

  private extractJsonObject(text: string, startIndex: number): string | null {
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            const jsonStr = text.substring(startIndex, i + 1);
            // Validate by parsing
            JSON.parse(jsonStr);
            return jsonStr;
          }
        }
      }
    }

    return null;
  }

  private extractJsonArray(text: string, startIndex: number): string | null {
    let bracketCount = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === '\\') {
        escapeNext = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '[') {
          bracketCount++;
        } else if (char === ']') {
          bracketCount--;
          if (bracketCount === 0) {
            const jsonStr = text.substring(startIndex, i + 1);
            // Validate by parsing
            JSON.parse(jsonStr);
            return jsonStr;
          }
        }
      }
    }

    return null;
  }

  /**
   * Test the model with simple prompts
   */
  async testModel(): Promise<{
    simpleTest: string;
    jsonTest: string;
    modelInfo: unknown;
  }> {
    try {
      // Test 1: Simple completion
      const simpleTest = await this.generateCompletion(
        'Say "Hello, I am working!" in a single sentence.',
        { temperature: 0.1 },
      );

      // Test 2: JSON completion
      const jsonTest = await this.generateCompletion(
        `Return this JSON: {"status": "working", "model": "${
          this.MODEL_NAME
        }"}`,
        { temperature: 0.1 },
      );

      // Test 3: Model info
      const modelInfoResponse = await axios.get(
        `${this.OLLAMA_BASE_URL}/api/tags`,
        { timeout: 5000 },
      );

      return {
        simpleTest,
        jsonTest,
        modelInfo: modelInfoResponse.data,
      };
    } catch (error) {
      this.logger.error('Test method failed', error);
      throw error;
    }
  }

  /**
   * Check if Ollama service is available and model is loaded
   */
  async healthCheck(): Promise<{
    status: string;
    model: string;
    available: boolean;
    models?: string[];
  }> {
    try {
      // Check if Ollama is running
      const response = await axios.get<OllamaTagsResponse>(
        `${this.OLLAMA_BASE_URL}/api/tags`,
        {
          timeout: 5000,
          httpAgent: this.httpAgent,
        },
      );

      // Get list of available models
      const models = response.data?.models || [];
      const modelNames = models.map((m) => m.name);

      // Check if our model is available
      const modelAvailable = models.some((model) =>
        model.name.includes(this.MODEL_NAME),
      );

      if (!modelAvailable) {
        this.logger.warn(
          `Model ${this.MODEL_NAME} not found in available models`,
          { availableModels: modelNames },
        );
        return {
          status: 'warning',
          model: this.MODEL_NAME,
          available: false,
          models: modelNames,
        };
      }

      return {
        status: 'healthy',
        model: this.MODEL_NAME,
        available: true,
        models: modelNames,
      };
    } catch (error) {
      this.logger.error('Health check failed', error);
      return {
        status: 'unhealthy',
        model: this.MODEL_NAME,
        available: false,
      };
    }
  }

  /**
   * Get available models from Ollama
   */
  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await axios.get<OllamaTagsResponse>(
        `${this.OLLAMA_BASE_URL}/api/tags`,
        {
          timeout: 5000,
          httpAgent: this.httpAgent,
        },
      );

      return response.data?.models?.map((model) => model.name) || [];
    } catch (error) {
      this.logger.error('Failed to get available models', error);
      return [];
    }
  }

  /**
   * Get current model name
   */
  getModelName(): string {
    return this.MODEL_NAME;
  }

  /**
   * Clean up resources
   */
  onModuleDestroy() {
    this.httpAgent.destroy();
  }
}
