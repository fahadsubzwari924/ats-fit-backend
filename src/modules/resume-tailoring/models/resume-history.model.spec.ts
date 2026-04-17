import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import {
  ResumeHistoryItem,
  ResumeHistoryDetail,
  PaginatedResumeHistory,
} from './resume-history.model';

function buildEntity(
  overrides: Partial<ResumeGeneration> = {},
): ResumeGeneration {
  const entity = new ResumeGeneration();
  entity.id = 'test-uuid-1234';
  entity.company_name = 'Acme Corp';
  entity.job_position = 'Senior Engineer';
  entity.optimization_confidence = 87.5;
  entity.keywords_added = 12;
  entity.sections_optimized = 4;
  entity.template_id = 'tpl-abc';
  entity.created_at = new Date('2025-01-15T10:00:00Z');
  entity.pdf_s3_key = 'resumes/output/test-uuid-1234.pdf';
  entity.achievements_quantified = 3;
  entity.changes_diff = { added: ['leadership'], removed: [] };
  return Object.assign(entity, overrides);
}

describe('ResumeHistoryItem', () => {
  it('maps all fields correctly from a mock entity', () => {
    const entity = buildEntity();
    const item = new ResumeHistoryItem(entity);

    expect(item.id).toBe('test-uuid-1234');
    expect(item.companyName).toBe('Acme Corp');
    expect(item.jobPosition).toBe('Senior Engineer');
    expect(item.optimizationConfidence).toBeNull(); // deprecated, always null
    expect(item.keywordsAdded).toBe(12);
    expect(item.sectionsOptimized).toBe(4);
    expect(item.templateId).toBe('tpl-abc');
    expect(item.createdAt).toEqual(new Date('2025-01-15T10:00:00Z'));
    expect(item.canDownload).toBe(true);
  });

  it('sets canDownload to true when pdf_s3_key is set', () => {
    const entity = buildEntity({ pdf_s3_key: 'resumes/output/some-key.pdf' });
    const item = new ResumeHistoryItem(entity);
    expect(item.canDownload).toBe(true);
  });

  it('sets canDownload to false when pdf_s3_key is null', () => {
    const entity = buildEntity({ pdf_s3_key: null as any });
    const item = new ResumeHistoryItem(entity);
    expect(item.canDownload).toBe(false);
  });

  it('sets canDownload to false when pdf_s3_key is undefined', () => {
    const entity = buildEntity({ pdf_s3_key: undefined as any });
    const item = new ResumeHistoryItem(entity);
    expect(item.canDownload).toBe(false);
  });

  it('coalesces undefined numeric fields to null', () => {
    const entity = buildEntity({
      optimization_confidence: undefined as any,
      keywords_added: undefined as any,
      sections_optimized: undefined as any,
      template_id: undefined as any,
    });
    const item = new ResumeHistoryItem(entity);

    expect(item.optimizationConfidence).toBeNull();
    expect(item.keywordsAdded).toBeNull();
    expect(item.sectionsOptimized).toBeNull();
    expect(item.templateId).toBeNull();
  });
});

describe('ResumeHistoryDetail', () => {
  it('extends ResumeHistoryItem and inherits all base fields', () => {
    const entity = buildEntity();
    const detail = new ResumeHistoryDetail(entity);

    // Inherited from ResumeHistoryItem
    expect(detail.id).toBe('test-uuid-1234');
    expect(detail.companyName).toBe('Acme Corp');
    expect(detail.jobPosition).toBe('Senior Engineer');
    expect(detail.optimizationConfidence).toBeNull(); // deprecated, always null
    expect(detail.keywordsAdded).toBe(12);
    expect(detail.sectionsOptimized).toBe(4);
    expect(detail.templateId).toBe('tpl-abc');
    expect(detail.createdAt).toEqual(new Date('2025-01-15T10:00:00Z'));
    expect(detail.canDownload).toBe(true);

    // Instanceof check
    expect(detail).toBeInstanceOf(ResumeHistoryItem);
  });

  it('adds achievementsQuantified and changesDiff fields', () => {
    const entity = buildEntity();
    const detail = new ResumeHistoryDetail(entity);

    expect(detail.achievementsQuantified).toBe(3);
    expect(detail.changesDiff).toEqual({ added: ['leadership'], removed: [] });
  });

  it('coalesces undefined achievementsQuantified and changesDiff to null', () => {
    const entity = buildEntity({
      achievements_quantified: undefined as any,
      changes_diff: undefined as any,
    });
    const detail = new ResumeHistoryDetail(entity);

    expect(detail.achievementsQuantified).toBeNull();
    expect(detail.changesDiff).toBeNull();
  });

  it('coalesces null changesDiff to null', () => {
    const entity = buildEntity({ changes_diff: null });
    const detail = new ResumeHistoryDetail(entity);
    expect(detail.changesDiff).toBeNull();
  });
});

describe('PaginatedResumeHistory interface', () => {
  it('accepts a valid paginated structure', () => {
    const entity = buildEntity();
    const item = new ResumeHistoryItem(entity);

    const paginated: PaginatedResumeHistory = {
      items: [item],
      total: 1,
      page: 1,
      limit: 10,
    };

    expect(paginated.items).toHaveLength(1);
    expect(paginated.total).toBe(1);
    expect(paginated.page).toBe(1);
    expect(paginated.limit).toBe(10);
  });
});
