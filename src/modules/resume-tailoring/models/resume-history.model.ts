import { UserPlan } from '../../../database/entities/user.entity';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';

export class ResumeHistoryItem {
  id: string;
  companyName: string;
  jobPosition: string;
  optimizationConfidence: number | null;
  keywordsAdded: number | null;
  sectionsOptimized: number | null;
  templateId: string | null;
  createdAt: Date;
  canDownload: boolean;

  constructor(entity: ResumeGeneration) {
    this.id = entity.id;
    this.companyName = entity.company_name;
    this.jobPosition = entity.job_position;
    this.optimizationConfidence = entity.optimization_confidence ?? null;
    this.keywordsAdded = entity.keywords_added ?? null;
    this.sectionsOptimized = entity.sections_optimized ?? null;
    this.templateId = entity.template_id ?? null;
    this.createdAt = entity.created_at;
    this.canDownload = !!entity.pdf_s3_key;
  }
}

export class ResumeHistoryDetail extends ResumeHistoryItem {
  achievementsQuantified: number | null;
  changesDiff: Record<string, unknown> | null;

  constructor(entity: ResumeGeneration) {
    super(entity);
    this.achievementsQuantified = entity.achievements_quantified ?? null;
    this.changesDiff = (entity.changes_diff as Record<string, unknown>) ?? null;
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
