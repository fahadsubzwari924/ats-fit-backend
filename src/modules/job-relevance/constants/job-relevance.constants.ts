export const JOB_RELEVANCE_CONSTANTS = {
  THRESHOLDS: {
    LOW_MAX: 39,
    MEDIUM_MAX: 65,
  },
  LLM: {
    MODEL: 'claude-haiku-4-5-20251001',
    /**
     * Output token budget for the structured relevance response. Sized for
     * the v4 schema: up to `MANDATORY_TECHS_MAX` (8) enumerated tech entries
     * + 3 strengths + dimensions + score/verdict + JSON overhead. Empirical
     * worst-case ~1100 tokens; 2000 gives ~80% headroom so a verbose model
     * day or a JD with many requirements doesn't truncate the tool_use
     * block (which silently breaks parsing → buildFallback path fires).
     *
     * History:
     *   - 350 (pre-v4): adequate for the old schema (gaps + strengths only).
     *     Truncated the new schema → fallback regression → bumped to 2000.
     */
    MAX_TOKENS: 2000,
    /**
     * Hard ceiling for the full request round-trip. Sized to fit the worst
     * case: full 2000-token response from Haiku 4.5 (≈10-15s generation at
     * 100-200 tok/sec) + 1-2s prompt-cache miss latency + 1s network. 30s
     * gives ~50% headroom; tight enough that a hung worker doesn't block
     * the pipeline forever.
     *
     * History:
     *   - 8000 (pre-v5): adequate for the old ~350-token responses. Caused
     *     silent timeouts on the new schema → buildFallback fired every
     *     time with no log → "50% medium, empty gaps" UX regression.
     */
    TIMEOUT_MS: 30000,
    RETRY_DELAY_MS: 500,
    MAX_RETRIES: 2,
    TOOL_NAME: 'score_job_relevance',
    API_VERSION: '2023-06-01',
    BETA_HEADER: 'prompt-caching-2024-07-31',
    USER_AGENT: 'ATS-Fit-Backend/1.0',
  },
  DIMENSION_LABEL_THRESHOLDS: { MISMATCH_MAX: 39, PARTIAL_MAX: 65 },
  /**
   * Maximum entries the LLM may return in `mandatoryTechs`. Average JD has
   * 3-6 mandatory techs; 8 is more than enough headroom while keeping the
   * response payload under MAX_TOKENS. Kept in sync with the `maxItems: 8`
   * on the tool's input_schema.
   */
  MANDATORY_TECHS_MAX: 8,
  /**
   * Maximum entries surfaced to the FE in `gaps`. Server derives `gaps`
   * from `mandatoryTechs` and trims to this cap (LLM listed in priority
   * order — most critical first).
   */
  GAPS_MAX: 4,
  CACHE: {
    TTL_SECONDS: 60 * 60 * 24,
    /**
     * Cache namespace version. Bump whenever the scoring prompt or output
     * contract changes in a way that would make previously-cached results
     * stale or wrong.
     *
     * Version history:
     * - v1: initial release.
     * - v2: pre-generation relevance two-call flow + cache-hit engine.
     * - v3: stricter `gaps` enforcement in `RUBRIC_SYSTEM_BLOCK` (prompt-
     *   only; proved insufficient — Haiku still produced empty gaps for
     *   Partial/Aligned cases).
     * - v4: schema-enforced `mandatoryTechs` enumeration (no `gaps` field).
     *   Output shape changed → cache bump.
     * - v5: token-budget + schema-size correction. v4 was shipped with
     *   MAX_TOKENS=350 (pre-existing value, inadequate for the new schema),
     *   so v4 cache entries are mostly buildFallback rows from truncated
     *   LLM responses. v5 bumps MAX_TOKENS to 2000, tightens schema item
     *   caps, and invalidates the poisoned v4 entries.
     */
    KEY_PREFIX: 'relevance:v5',
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
