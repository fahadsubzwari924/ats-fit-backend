import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobRelevanceCacheService } from './cache/job-relevance-cache.service';
import { JobRelevanceKeywordFastPathService } from './fast-path/job-relevance-keyword-fast-path.service';
import { JobRelevanceLlmClient } from './clients/job-relevance-llm.client';
import { JOB_RELEVANCE_CONSTANTS } from './constants/job-relevance.constants';
import { JobRelevanceEngine } from './enums/job-relevance-engine.enum';
import { JobRelevanceVerdict } from './enums/job-relevance-verdict.enum';
import { JobRelevanceDimensionLabel } from './enums/job-relevance-dimension-label.enum';
import { JobRelevanceSkipReason } from './enums/job-relevance-skip-reason.enum';
import type { JobRelevanceResult } from './interfaces/job-relevance.interface';
import type {
  JobRelevanceInput,
  JobRelevanceProfileSource,
} from './interfaces/job-relevance-input.interface';

@Injectable()
export class JobRelevanceService {
  private readonly logger = new Logger(JobRelevanceService.name);

  constructor(
    private readonly cache: JobRelevanceCacheService,
    private readonly fastPath: JobRelevanceKeywordFastPathService,
    private readonly llm: JobRelevanceLlmClient,
    private readonly config: ConfigService,
  ) {}

  async score(input: JobRelevanceInput): Promise<JobRelevanceResult> {
    if (!this.isEnabled()) {
      return this.handleSkipped(input, JobRelevanceSkipReason.FEATURE_DISABLED);
    }
    if (input.profile.kind === 'none') {
      return this.handleSkipped(input, JobRelevanceSkipReason.NO_PROFILE);
    }

    const profileText = this.flattenProfile(input.profile);
    if (!profileText.trim()) {
      return this.handleSkipped(input, JobRelevanceSkipReason.EMPTY_PROFILE);
    }

    const profileVersion =
      input.profile.kind === 'enriched' ? input.profile.profileVersion : 0;
    const cacheKey = this.cache.buildKey(profileVersion, input.jobDescription);

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      const hit: JobRelevanceResult = this.applyHardRequirementOverride({
        ...cached,
        engine: JobRelevanceEngine.CACHE_HIT,
        cacheKey,
      });
      this.log(input, hit);
      return hit;
    }

    const fast = this.fastPath.tryScore(profileText, input.jobDescription);
    if (fast) {
      const result: JobRelevanceResult = this.applyHardRequirementOverride({
        ...fast,
        cacheKey,
      });
      await this.cache.set(cacheKey, result);
      this.log(input, result);
      return result;
    }

    const llmResult = await this.llm.score({
      profileText,
      jobPosition: input.jobPosition,
      companyName: input.companyName,
      jobDescription: input.jobDescription,
      abortSignal: input.abortSignal,
    });

    const final: JobRelevanceResult = this.applyHardRequirementOverride({
      ...llmResult,
      cacheKey,
    });
    if (final.engine === JobRelevanceEngine.LLM) {
      await this.cache.set(cacheKey, final);
    }
    this.log(input, final);
    return final;
  }

  /**
   * Hard-requirement guard: when the techStack dimension is labelled Mismatch
   * (score ≤ 39), the composite verdict is forced to LOW regardless of the
   * other dimensions. Tech-stack mismatch on a tech role means the candidate
   * cannot realistically apply, so role-type or experience-level alignment
   * must not be allowed to pull the verdict up.
   */
  private applyHardRequirementOverride(
    result: JobRelevanceResult,
  ): JobRelevanceResult {
    if (
      result.dimensions.techStack.label === JobRelevanceDimensionLabel.MISMATCH
    ) {
      return { ...result, verdict: JobRelevanceVerdict.LOW };
    }
    return result;
  }

  private isEnabled(): boolean {
    return (
      this.config.get<string>(JOB_RELEVANCE_CONSTANTS.FEATURE_FLAG_ENV) ===
      'true'
    );
  }

  private flattenProfile(source: JobRelevanceProfileSource): string {
    if (source.kind === 'enriched' || source.kind === 'extracted') {
      try {
        return JSON.stringify(source.content);
      } catch {
        return '';
      }
    }
    if (source.kind === 'raw-text') return source.text;
    return '';
  }

  /**
   * Builds the UNAVAILABLE sentinel returned when scoring can't run. The
   * historical behavior (score=100, verdict=HIGH) was actively misleading —
   * it surfaced as "100% fit" in the UI even when the feature was disabled
   * or the user had no resume. The new sentinel uses a distinct verdict
   * (`UNAVAILABLE`) and tags the cause via `unavailableReason` so the FE
   * can render targeted guidance.
   *
   * Dimension scores are set to `SKIPPED.DIMENSION_SCORE` with MISMATCH
   * labels — they're never meant to be displayed when the verdict is
   * UNAVAILABLE, but the interface requires populated dimensions.
   */
  private buildSkipped(reason: JobRelevanceSkipReason): JobRelevanceResult {
    const { COMPOSITE_SCORE, DIMENSION_SCORE } =
      JOB_RELEVANCE_CONSTANTS.SKIPPED;
    return {
      score: COMPOSITE_SCORE,
      verdict: JobRelevanceVerdict.UNAVAILABLE,
      dimensions: {
        techStack: {
          score: DIMENSION_SCORE,
          label: JobRelevanceDimensionLabel.MISMATCH,
        },
        roleType: {
          score: DIMENSION_SCORE,
          label: JobRelevanceDimensionLabel.MISMATCH,
        },
        experienceLevel: {
          score: DIMENSION_SCORE,
          label: JobRelevanceDimensionLabel.MISMATCH,
        },
      },
      gaps: [],
      strengths: [],
      engine: JobRelevanceEngine.SKIPPED,
      model: null,
      latencyMs: 0,
      cacheKey: null,
      computedAt: new Date().toISOString(),
      acknowledgedLowFit: false,
      unavailableReason: reason,
    };
  }

  /**
   * Build the sentinel AND log it. Previously the three early `buildSkipped()`
   * returns in `score()` short-circuited before `log()` was reached, leaving
   * production silent about why the feature was a no-op. Funneling through
   * here guarantees every skipped path is observable.
   */
  private handleSkipped(
    input: JobRelevanceInput,
    reason: JobRelevanceSkipReason,
  ): JobRelevanceResult {
    const result = this.buildSkipped(reason);
    this.log(input, result);
    return result;
  }

  private log(input: JobRelevanceInput, result: JobRelevanceResult): void {
    const reasonSuffix = result.unavailableReason
      ? ` reason=${result.unavailableReason}`
      : '';
    this.logger.log(
      `[JobRelevance] user=${input.userId ?? 'anon'} engine=${result.engine} score=${result.score} verdict=${result.verdict} latencyMs=${result.latencyMs} cacheKey=${result.cacheKey ?? 'none'}${reasonSuffix}`,
    );
  }
}
