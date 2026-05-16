export enum JobRelevanceVerdict {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  /**
   * Sentinel verdict returned when the scoring pipeline could not run at all
   * (feature flag off, missing profile, empty profile). Distinct from LOW so
   * downstream gates (`isLowFit`) don't treat unscored requests as low-fit,
   * and the frontend can render a "fit check unavailable" message instead of
   * a misleading "100% fit" / "low fit" surface.
   */
  UNAVAILABLE = 'unavailable',
}
