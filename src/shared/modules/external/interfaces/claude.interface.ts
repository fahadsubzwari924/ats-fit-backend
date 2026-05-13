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
  /**
   * Opaque attempt counter threaded through by callers so structured prod
   * telemetry can distinguish first-call vs retry-call log lines. Defaults
   * to 1 when omitted. Intended for use by retry wrappers (e.g. the
   * optimizer's two-tier retry — see Task C of the batch-tailoring
   * resilience plan).
   */
  attempt?: number;
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
