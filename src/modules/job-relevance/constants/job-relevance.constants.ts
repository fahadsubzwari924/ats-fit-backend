export const JOB_RELEVANCE_CONSTANTS = {
  THRESHOLDS: {
    LOW_MAX: 39,
    MEDIUM_MAX: 65,
  },
  LLM: {
    MODEL: 'claude-haiku-4-5-20251001',
    MAX_TOKENS: 350,
    TIMEOUT_MS: 8000,
    RETRY_DELAY_MS: 500,
    MAX_RETRIES: 2,
    TOOL_NAME: 'score_job_relevance',
    API_VERSION: '2023-06-01',
    BETA_HEADER: 'prompt-caching-2024-07-31',
    USER_AGENT: 'ATS-Fit-Backend/1.0',
  },
  DIMENSION_LABEL_THRESHOLDS: { MISMATCH_MAX: 39, PARTIAL_MAX: 65 },
  CACHE: {
    TTL_SECONDS: 60 * 60 * 24,
    KEY_PREFIX: 'relevance:v2',
  },
  TRUNCATION: {
    JD_MAX_CHARS: 3000,
    PROFILE_MAX_CHARS: 8000,
  },
  KEYWORD_FAST_PATH: {
    HIGH_SKIP_THRESHOLD: 75,
    LOW_SKIP_THRESHOLD: 15,
  },
  DIMENSION_WEIGHTS: {
    TECH_STACK: 0.4,
    ROLE_TYPE: 0.3,
    EXPERIENCE_LEVEL: 0.3,
  },
  /**
   * Sentinel values used by `buildSkipped()` when the scoring pipeline can't
   * run. Kept as a named block so the intent is explicit at call sites and
   * search-friendly across the codebase (no magic 0s sprinkled around).
   * The frontend should detect this case via `verdict === UNAVAILABLE` (or
   * `unavailableReason !== undefined`) rather than the numeric score.
   */
  SKIPPED: {
    COMPOSITE_SCORE: 0,
    DIMENSION_SCORE: 0,
  },
  FEATURE_FLAG_ENV: 'JOB_RELEVANCE_GATE_ENABLED',
  RESPONSE_TYPES: {
    LOW_FIT_WARNING: 'low_fit_warning',
    BATCH_LOW_FIT_WARNING: 'batch_low_fit_warning',
  },
  HEADERS: {
    RELEVANCE_SCORE: 'X-Relevance-Score',
    RELEVANCE_VERDICT: 'X-Relevance-Verdict',
    RELEVANCE_CACHE_HIT: 'X-Relevance-Cache-Hit',
    RELEVANCE_BLOCK: 'X-Relevance-Block',
  },
  DB: {
    REDIS_PROVIDER_TOKEN: 'JOB_RELEVANCE_REDIS',
  },
} as const;
