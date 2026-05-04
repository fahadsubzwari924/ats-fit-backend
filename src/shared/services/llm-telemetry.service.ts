import { Injectable, Logger } from '@nestjs/common';

export interface LlmCallRecord {
  prompt_id: string;
  prompt_version: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  latency_ms: number;
  retry_count: number;
  parse_outcome: 'success' | 'failure';
  fallback_triggered: boolean;
}

@Injectable()
export class LlmTelemetryService {
  private readonly logger = new Logger('LlmTelemetry');

  record(data: LlmCallRecord): void {
    this.logger.log(JSON.stringify({ event: 'llm_call', ...data }));
  }
}
