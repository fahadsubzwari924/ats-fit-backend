import type { JobRelevanceVerdict } from '../enums/job-relevance-verdict.enum';
import type { JobRelevanceEngine } from '../enums/job-relevance-engine.enum';
import type { JobRelevanceDimensionLabel } from '../enums/job-relevance-dimension-label.enum';
import type { JobRelevanceSkipReason } from '../enums/job-relevance-skip-reason.enum';

export interface JobRelevanceDimension {
  /** Integer in range [0, 100] */
  score: number;
  label: JobRelevanceDimensionLabel;
}

export interface JobRelevanceDimensions {
  techStack: JobRelevanceDimension;
  roleType: JobRelevanceDimension;
  experienceLevel: JobRelevanceDimension;
}

export interface JobRelevanceResult {
  /** Weighted composite score, integer in range [0, 100] */
  score: number;
  verdict: JobRelevanceVerdict;
  dimensions: JobRelevanceDimensions;
  gaps: string[];
  strengths: string[];
  engine: JobRelevanceEngine;
  model: string | null;
  latencyMs: number;
  cacheKey: string | null;
  computedAt: string;
  acknowledgedLowFit: boolean;
  /**
   * Populated only when `verdict === UNAVAILABLE` (i.e. the scoring pipeline
   * was bypassed). Tells the frontend WHY scoring was skipped so it can show
   * targeted guidance — "upload a resume first" vs "feature unavailable" —
   * rather than rendering a misleading score.
   */
  unavailableReason?: JobRelevanceSkipReason;
}
