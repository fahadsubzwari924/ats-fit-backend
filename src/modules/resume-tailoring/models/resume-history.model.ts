import { UserPlan } from '../../../database/entities/user.entity';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { MatchScoreBlock } from '../interfaces/match-score-block.interface';
import { classifyMatchScore } from '../services/match-score-classifier.service';

export class ResumeHistoryItem {
  id: string;
  companyName: string;
  jobPosition: string;
  /** @deprecated kept for backward compatibility; always null now */
  optimizationConfidence: number | null;
  keywordsAdded: number | null;
  sectionsOptimized: number | null;
  templateId: string | null;
  createdAt: Date;
  canDownload: boolean;
  hasCoverLetter: boolean;
  /**
   * Canonical MatchScoreBlock — `null` when scores were never persisted for
   * this record (legacy v2.0/v2.1 rows without `match_score_*` columns).
   * The previous fallback that substituted `changesDiff.keywordAnalysis.
   * coverage*` is intentionally removed: post-Task-A those coverage numbers
   * are produced by the same scorer, so a null column truly means the row
   * was never scored — the FE handles `null` gracefully.
   */
  matchScore: MatchScoreBlock | null;
  atsChecks: { passed: number; total: number } | null;

  constructor(entity: ResumeGeneration) {
    this.id = entity.id;
    this.companyName = entity.company_name;
    this.jobPosition = entity.job_position;
    this.optimizationConfidence = null; // deprecated
    this.keywordsAdded = entity.keywords_added ?? null;
    this.sectionsOptimized = entity.sections_optimized ?? null;
    this.templateId = entity.template_id ?? null;
    this.createdAt = entity.created_at;
    this.canDownload = !!entity.pdf_s3_key;
    this.hasCoverLetter = !!entity.cover_letter;

    this.matchScore =
      entity.matchScoreBefore != null && entity.matchScoreAfter != null
        ? classifyMatchScore(entity.matchScoreBefore, entity.matchScoreAfter)
        : null;

    this.atsChecks =
      entity.atsChecksPassed != null
        ? { passed: entity.atsChecksPassed, total: entity.atsChecksTotal ?? 10 }
        : null;
  }
}

export class ResumeHistoryDetail extends ResumeHistoryItem {
  achievementsQuantified: number | null;
  changesDiff: Record<string, unknown> | null;
  bulletsQuantified: { before: number; after: number; total: number } | null;

  constructor(entity: ResumeGeneration) {
    super(entity);
    this.achievementsQuantified = entity.achievements_quantified ?? null;
    this.changesDiff = (entity.changes_diff as Record<string, unknown>) ?? null;

    this.bulletsQuantified =
      entity.bulletsQuantifiedBefore != null
        ? {
            before: entity.bulletsQuantifiedBefore,
            after: entity.bulletsQuantifiedAfter ?? 0,
            total: entity.bulletsQuantifiedAfter ?? 0,
          }
        : null;

    // NOTE: the legacy fallback that derived matchScore from
    // `changesDiff.keywordAnalysis.coverage*` has been removed. After Task A,
    // coverage* is produced by the same `KeywordMatchScoringService` that
    // produces `match_score_*`, so a null `matchScore` truly means the row
    // was never scored. Substituting coverage values would either be a
    // duplicate (when columns are populated) or stale data (legacy rows),
    // both of which the FE handles by rendering the absence explicitly.
  }
}

export interface PaginatedResumeHistory {
  items: ResumeHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

export interface ResumeHistoryQueryOptions {
  page?: number;
  limit?: number;
  search?: string;
  sortOrder?: 'ASC' | 'DESC';
  plan?: UserPlan;
}
