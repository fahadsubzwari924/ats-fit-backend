import { UserPlan } from '../../../database/entities/user.entity';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';

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
  matchScore: { before: number; after: number; delta: number } | null;
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

    this.matchScore =
      entity.matchScoreBefore != null && entity.matchScoreAfter != null
        ? {
            before: entity.matchScoreBefore,
            after: entity.matchScoreAfter,
            delta: entity.matchScoreAfter - entity.matchScoreBefore,
          }
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

    // Fallback: derive matchScore from changesDiff.keywordAnalysis for older records
    const diff = entity.changes_diff as {
      keywordAnalysis?: { coverageOriginal: number; coverageOptimized: number };
    } | null;
    if (!this.matchScore && diff?.keywordAnalysis) {
      const ka = diff.keywordAnalysis;
      this.matchScore = {
        before: ka.coverageOriginal,
        after: ka.coverageOptimized,
        delta: ka.coverageOptimized - ka.coverageOriginal,
      };
    }
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
