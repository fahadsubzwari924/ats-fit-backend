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
export const MAX_TOKENS_OPTIMIZATION = 8000;
