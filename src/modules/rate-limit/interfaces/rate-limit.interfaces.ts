/**
 * Result of a single rate-limit check for one feature.
 */
export interface RateLimitResult {
  allowed: boolean;
  currentUsage: number;
  limit: number;
  remaining: number;
  resetDate: Date;
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
  resetDate: Date;
}

/**
 * Aggregated usage stats returned by getUserUsageStats().
 * FREEMIUM: resume_generation + cover_letter.
 * PREMIUM:  resume_generation + cover_letter + resume_batch_generation.
 */
export interface UserUsageStats {
  resume_generation: RateLimitResult;
  cover_letter: RateLimitResult;
  resume_batch_generation?: RateLimitResult;
}
