import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobRelevanceCacheService } from './cache/job-relevance-cache.service';
import { JobRelevanceKeywordFastPathService } from './fast-path/job-relevance-keyword-fast-path.service';
import { JobRelevanceLlmClient } from './clients/job-relevance-llm.client';
import { JOB_RELEVANCE_CONSTANTS } from './constants/job-relevance.constants';
import { JobRelevanceEngine } from './enums/job-relevance-engine.enum';
import { JobRelevanceVerdict } from './enums/job-relevance-verdict.enum';
import { JobRelevanceDimensionLabel } from './enums/job-relevance-dimension-label.enum';
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
    if (!this.isEnabled()) return this.buildSkipped();
    if (input.profile.kind === 'none') return this.buildSkipped();

    const profileText = this.flattenProfile(input.profile);
    if (!profileText.trim()) return this.buildSkipped();

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

  private buildSkipped(): JobRelevanceResult {
    return {
      score: 100,
      verdict: JobRelevanceVerdict.HIGH,
      dimensions: {
        techStack: { score: 100, label: JobRelevanceDimensionLabel.ALIGNED },
        roleType: { score: 100, label: JobRelevanceDimensionLabel.ALIGNED },
        experienceLevel: {
          score: 100,
          label: JobRelevanceDimensionLabel.ALIGNED,
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
    };
  }

  private log(input: JobRelevanceInput, result: JobRelevanceResult): void {
    this.logger.log(
      `[JobRelevance] user=${input.userId ?? 'anon'} engine=${result.engine} score=${result.score} verdict=${result.verdict} latencyMs=${result.latencyMs} cacheKey=${result.cacheKey ?? 'none'}`,
    );
  }
}
