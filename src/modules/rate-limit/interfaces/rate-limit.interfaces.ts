/**
 * Result of a single rate-limit check for one feature.
 */
export interface RateLimitResult {
  allowed: boolean;
  currentUsage: number;
  limit: number;
  remaining: number;
  /** End of the current billing period. */
  resetDate: Date;
  /** Start of the current billing period. */
  cycleStart: Date;
  usagePercentage: number;
}

/**
 * Formatted usage entry returned by GET /users/feature-usage.
 */
export interface FormattedFeatureUsage {
  feature: string;
  allowed: number;
  remaining: number;
  used: number;
  usagePercentage: string;
  /** End of the current billing period. */
  resetDate: Date;
  /** Start of the current billing period. */
  cycleStart: Date;
  /** Whole days remaining until the period ends (≥ 0). */
  daysRemaining: number;
}

/**
 * Aggregated usage stats returned by getUserUsageStats().
 * FREEMIUM: resume_generation + cover_letter + job_relevance_score.
 * PREMIUM:  resume_generation + cover_letter + resume_batch_generation + job_relevance_score.
 */
export interface UserUsageStats {
  resume_generation: RateLimitResult;
  cover_letter: RateLimitResult;
  job_relevance_score: RateLimitResult;
  resume_batch_generation?: RateLimitResult;
}
