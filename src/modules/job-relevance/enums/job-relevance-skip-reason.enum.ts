/**
 * Reasons why JobRelevanceService.score() bypassed the scoring pipeline and
 * returned a sentinel (UNAVAILABLE) result rather than a real LOW/MEDIUM/HIGH
 * verdict.
 *
 * These values surface to the frontend on `JobRelevanceResult.unavailableReason`
 * so the UI can render targeted guidance ("upload a resume", "feature
 * unavailable") rather than a misleading "100% fit" fallback.
 */
export enum JobRelevanceSkipReason {
  /** `JOB_RELEVANCE_GATE_ENABLED` env var is not set to 'true'. */
  FEATURE_DISABLED = 'feature_disabled',
  /** The user has no enriched profile and no extracted resume content. */
  NO_PROFILE = 'no_profile',
  /** A profile exists but its serialized content is empty/whitespace. */
  EMPTY_PROFILE = 'empty_profile',
}
