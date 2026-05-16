export enum JobRelevanceEngine {
  LLM = 'llm',
  KEYWORD_FAST_PATH = 'keyword-fast-path',
  CACHE_HIT = 'cache-hit',
  FALLBACK = 'fallback',
  TIMEOUT = 'timeout',
  SKIPPED = 'skipped',
}
