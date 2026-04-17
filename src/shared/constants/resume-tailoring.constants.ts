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
