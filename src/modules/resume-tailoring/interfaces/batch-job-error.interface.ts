/**
 * Canonical error envelope persisted on `batch_tailoring_jobs.error_message`
 * (JSON-encoded, no migration — the column stays `text`).
 *
 * Single source of truth for failure semantics across BE persistence, SSE
 * payloads, API responses, and FE rendering. The FE reads `category` to pick
 * the headline, `userMessage` for the subline, and `retryable` to decide
 * whether to show the per-job retry button.
 *
 * Categories are intentionally coarse — they map directly to user-facing copy
 * variants, not to internal error taxonomies.
 */
export type BatchJobErrorCategory =
  // LLM returned partial output; validation guard caught it
  | 'AI_TRUNCATION'
  // 529 / sustained rate-limit from the provider
  | 'AI_OVERLOAD'
  // Could not parse LLM JSON / tool_use payload
  | 'AI_PARSING'
  // 5xx, socket hangup, DNS, ECONNRESET etc. from upstream
  | 'NETWORK'
  // Catch-all — render the userMessage, default to retryable
  | 'UNKNOWN';

/**
 * Persisted/streamed shape. `userMessage` is the full ready-to-display copy
 * (headline + subline joined with a single space). `technicalDetail` is for
 * logs/ops — it MUST NOT contain PII or full stack traces.
 */
export interface BatchJobError {
  category: BatchJobErrorCategory;
  userMessage: string;
  technicalDetail: string;
  retryable: boolean;
  /** ISO-8601 timestamp the failure was classified */
  occurredAt: string;
}
