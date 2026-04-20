export interface IFeatureUsage {
  feature: string;
  allowed: number;
  remaining: number;
  used: number;
  usagePercentage: string;
  /** End of the current billing period (UTC ISO string or Date). */
  resetDate: Date;
  /** Start of the current billing period. */
  cycleStart: Date;
  /** Whole days remaining until the period ends. */
  daysRemaining: number;
}
