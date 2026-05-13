/**
 * Resume tailoring feature constants
 */

/**
 * Maximum number of resumes that can be generated in a single batch operation.
 * Premium feature: users can bulk tailor up to 3 resumes at once.
 */
export const BULK_TAILORING_MAX_RESUMES = 3;

// ---------------------------------------------------------------------------
// Match score
// ---------------------------------------------------------------------------

/** Keyword match score is capped here — a 100% match looks fake and is rare in practice. */
export const MATCH_SCORE_MAX_PERCENTAGE = 95;

// ---------------------------------------------------------------------------
// ATS checks
// ---------------------------------------------------------------------------

/** Total number of deterministic ATS checks performed per resume. */
export const ATS_TOTAL_CHECKS = 10;

/** Minimum fraction of experience bullets that must start with a capital letter. */
export const ATS_BULLET_CAPITAL_MIN_RATIO = 0.8;

// ---------------------------------------------------------------------------
// Diff computation
// ---------------------------------------------------------------------------

/**
 * Minimum Jaccard token-overlap score for two bullets to be considered
 * the "same" bullet across original vs optimized content.
 */
export const JACCARD_SIMILARITY_THRESHOLD = 0.25;

// ---------------------------------------------------------------------------
// Bullets quantified
// ---------------------------------------------------------------------------

/**
 * Regex that matches numeric evidence in a bullet point:
 * plain numbers, percentages, multipliers (x / k / K), and dollar amounts.
 */
export const QUANTIFIED_BULLET_REGEX = /\d+[%xkK]?|\$[\d,]+/;

// ---------------------------------------------------------------------------
// History pagination defaults
// ---------------------------------------------------------------------------

export const HISTORY_DEFAULT_PAGE = 1;
export const HISTORY_DEFAULT_LIMIT = 10;

// ---------------------------------------------------------------------------
// File path tokens
// ---------------------------------------------------------------------------

/** Prefix used when no original filename is available for a processed resume. */
export const RESUME_FALLBACK_FILE_PREFIX = 'resume-';

// ---------------------------------------------------------------------------
// Bullet relevance scoring
// ---------------------------------------------------------------------------

/** Per-experience bullet budget by experience rank (index 0 = most recent job). */
export const BULLET_BUDGET_PER_RANK = [7, 6, 5, 4, 3] as const;

/** Visibility weight per experience rank for scoring. Index 0 = most recent. */
export const BULLET_VISIBILITY_BY_RANK = [1.0, 0.85, 0.7, 0.5, 0.35] as const;

/** Minimum questionValue score for a bullet to be eligible for a profile question. */
export const MIN_QUESTION_VALUE = 0.35;

// ---------------------------------------------------------------------------
// Profile question generation
// ---------------------------------------------------------------------------

/** Maximum questions generated across all experiences. */
export const MAX_QUESTIONS_TOTAL = 9;

/** Per-job question budget by experience rank (index 0 = most recent). */
export const QUESTION_BUDGET_PER_RANK = [3, 2, 2, 1, 1] as const;

/** Maximum questions redistributable to top-2 jobs when lower jobs have unused slots. */
export const FLEX_REDISTRIBUTE_CAP = 5;

/** Estimated time in seconds per question answer (used for time gate). */
export const ESTIMATED_SEC_PER_QUESTION = 45;

/** Maximum total answer time in minutes before trimming lowest-value questions. */
export const MAX_TOTAL_MINUTES = 7;

// ---------------------------------------------------------------------------
// Resume optimization
// ---------------------------------------------------------------------------

/** Max output tokens for resume optimization LLM calls. */
export const MAX_TOKENS_OPTIMIZATION = 12000;

// Extended thinking budget. When enabled, max_tokens must cover budget + expected output.
export const EXTENDED_THINKING_BUDGET_TOKENS = 4000;
export const MAX_TOKENS_OPTIMIZATION_WITH_THINKING =
  MAX_TOKENS_OPTIMIZATION + EXTENDED_THINKING_BUDGET_TOKENS; // 16 000

// ---------------------------------------------------------------------------
// AI Models
// ---------------------------------------------------------------------------
export const MODEL_RESUME_EXTRACTION = 'gpt-4o';
export const MODEL_JD_ANALYSIS = 'gpt-4o-mini';
export const MODEL_OPTIMIZER_FALLBACK = 'gpt-4o-2024-11-20';
export const MODEL_PROFILE_QUESTIONS = 'gpt-4o-mini';
export const MODEL_PROFILE_ENRICHMENT = 'claude-haiku-4-5-20251001';

// ---------------------------------------------------------------------------
// AI Temperatures (named per prompt / call-site)
// ---------------------------------------------------------------------------
export const TEMP_RESUME_EXTRACTION = 0;
export const TEMP_JD_ANALYSIS = 0.05;
export const TEMP_OPTIMIZER = 0.2;
export const TEMP_PROFILE_QUESTIONS = 0.3;
export const TEMP_PROFILE_ENRICHMENT = 0.2;
export const TEMP_COVER_LETTER = 0.3;

// ---------------------------------------------------------------------------
// Max token budgets (per prompt / call-site)
// ---------------------------------------------------------------------------
export const MAX_TOKENS_RESUME_EXTRACTION = 4096;
export const MAX_TOKENS_JD_ANALYSIS = 1500;
export const MAX_TOKENS_PROFILE_QUESTIONS = 2000;
export const MAX_TOKENS_PROFILE_ENRICHMENT = 2000;
export const MAX_TOKENS_COVER_LETTER = 1500;
