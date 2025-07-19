// claude.interface.ts
export interface ClaudeRequestParams {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  response_format?: { type: 'json_object' };
  temperature?: number;
  max_tokens?: number;
}

export interface ClaudeResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export interface ClaudeAtsEvaluationParams {
  resumeText: string;
  jobDescription: string;
  prompt: string;
}

export interface ClaudeConfig {
  apiKey: string;
  baseUrl: string;
  maxRetries: number;
  retryDelay: number;
  defaultModel: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
}
