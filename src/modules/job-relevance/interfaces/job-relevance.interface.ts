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

/**
 * Per-mandatory-technology analysis emitted by the LLM. Forced by the tool
 * schema (`minItems: 1`) so the model cannot skip enumeration — `gaps` is
 * then derived authoritatively server-side from this list (filter where
 * `presentInProfile === false`).
 *
 * Persisted into `resume_generations.pre_generation_relevance` JSONB for
 * post-hoc audit ("what did Haiku think was mandatory for this JD?").
 */
export interface MandatoryTechAnalysis {
  /** Technology name as it appears in the JD (e.g. ".NET / ASP.NET Core"). */
  name: string;
  /** True when the candidate profile demonstrably mentions this technology. */
  presentInProfile: boolean;
  /** Optional rationale — where in the profile it was found, or why missing. */
  evidence?: string;
}

export interface JobRelevanceResult {
  /** Weighted composite score, integer in range [0, 100] */
  score: number;
  verdict: JobRelevanceVerdict;
  dimensions: JobRelevanceDimensions;
  gaps: string[];
  strengths: string[];
  /**
   * Structured enumeration of every mandatory technology the LLM identified
   * in the JD, marked present/missing. Server derives `gaps` from this when
   * available; field is optional for fallback / fast-path / legacy entries.
   */
  mandatoryTechs?: MandatoryTechAnalysis[];
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
