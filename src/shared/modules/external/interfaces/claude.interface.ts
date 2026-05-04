// claude.interface.ts
export interface ClaudeRequestParams {
  model?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  system?: Array<{
    type: 'text';
    text: string;
    cache_control?: { type: 'ephemeral' };
  }>;
  response_format?: { type: 'json_object' };
  temperature?: number;
  max_tokens?: number;
  promptId?: string;
  promptVersion?: string;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  tool_choice?: { type: 'tool'; name: string };
  thinking?: { type: 'enabled'; budget_tokens: number };
}

export interface ClaudeResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
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
