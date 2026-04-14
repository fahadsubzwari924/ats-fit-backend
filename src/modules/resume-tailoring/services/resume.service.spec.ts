import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { ResumeService } from './resume.service';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { Resume } from '../../../database/entities/resume.entity';
import { User, UserPlan } from '../../../database/entities/user.entity';
import { ResumeTemplateService } from './resume-templates.service';
import { TailoredResumePdfStorageService } from './tailored-resume-pdf-storage.service';
import { AIContentService } from '../../../shared/services/ai-content.service';
import { S3Service } from '../../../shared/modules/external/services/s3.service';
import { ResumeHistoryItem } from '../models/resume-history.model';
import { ResumeHistoryDetail } from '../models/resume-history.model';
import { FREEMIUM_HISTORY_LOOKBACK_DAYS } from '../../../shared/constants/plan-limits.constants';

const makeEntity = (
  overrides: Partial<ResumeGeneration> = {},
): ResumeGeneration =>
  ({
    id: 'gen-1',
    company_name: 'Acme',
    job_position: 'Engineer',
    optimization_confidence: 85,
    keywords_added: 5,
    sections_optimized: 3,
    template_id: 'tpl-1',
    created_at: new Date('2026-01-01T00:00:00Z'),
    pdf_s3_key: 's3-key',
    achievements_quantified: 2,
    changes_diff: { before: 'x', after: 'y' },
    user_id: 'user-1',
    ...overrides,
  }) as unknown as ResumeGeneration;

describe('ResumeService — history methods', () => {
  let service: ResumeService;
  let findMock: jest.Mock;
  let findOneMock: jest.Mock;
  let qbMock: {
    where: jest.Mock;
    andWhere: jest.Mock;
    select: jest.Mock;
    orderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
  };

  beforeEach(async () => {
    findMock = jest.fn();
    findOneMock = jest.fn();

    qbMock = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumeService,
        { provide: ResumeTemplateService, useValue: {} },
        { provide: AIContentService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: S3Service, useValue: {} },
        { provide: TailoredResumePdfStorageService, useValue: {} },
        {
          provide: getRepositoryToken(ResumeGeneration),
          useValue: {
            find: findMock,
            findOne: findOneMock,
            createQueryBuilder: jest.fn().mockReturnValue(qbMock),
          },
        },
        {
          provide: getRepositoryToken(Resume),
          useValue: {},
        },
        {
          provide: getRepositoryToken(User),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get(ResumeService);
  });

  // ─── getResumeGenerationHistory ───────────────────────────────────────────

  describe('getResumeGenerationHistory', () => {
    it('returns ResumeHistoryItem[] for all records when plan is undefined', async () => {
      const entity = makeEntity();
      findMock.mockResolvedValue([entity]);

      const result = await service.getResumeGenerationHistory('user-1', 10);

      expect(findMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 'user-1' } }),
      );
      // No created_at filter should be present
      const call = findMock.mock.calls[0][0];
      expect(call.where.created_at).toBeUndefined();

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(ResumeHistoryItem);
      expect(result[0].companyName).toBe('Acme');
      expect(result[0].canDownload).toBe(true);
    });

    it('applies 30-day date filter for FREEMIUM plan', async () => {
      const entity = makeEntity();
      findMock.mockResolvedValue([entity]);

      const before = Date.now();
      const result = await service.getResumeGenerationHistory(
        'user-1',
        10,
        UserPlan.FREEMIUM,
      );
      const after = Date.now();

      const call = findMock.mock.calls[0][0];
      const cutoff: Date = call.where.created_at?.value as Date;
      expect(cutoff).toBeDefined();
      const expectedMs = FREEMIUM_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - expectedMs);
      expect(cutoff.getTime()).toBeLessThanOrEqual(after - expectedMs);

      expect(result[0]).toBeInstanceOf(ResumeHistoryItem);
    });

    it('does not apply date filter for PREMIUM plan', async () => {
      findMock.mockResolvedValue([makeEntity()]);

      await service.getResumeGenerationHistory('user-1', 10, UserPlan.PREMIUM);

      const call = findMock.mock.calls[0][0];
      expect(call.where.created_at).toBeUndefined();
    });
  });

  // ─── getResumeGenerationHistoryPaginated ──────────────────────────────────

  describe('getResumeGenerationHistoryPaginated', () => {
    it('applies 30-day date filter for FREEMIUM via query builder', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[makeEntity()], 1]);

      const before = Date.now();
      const result = await service.getResumeGenerationHistoryPaginated(
        'user-1',
        { plan: UserPlan.FREEMIUM },
      );
      const after = Date.now();

      // andWhere should be called at least once with cutoff
      const cutoffCall = qbMock.andWhere.mock.calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' && args[0].includes('created_at'),
      );
      expect(cutoffCall).toBeDefined();
      expect(cutoffCall[1]).toHaveProperty('cutoff');

      const cutoff: Date = cutoffCall[1].cutoff;
      const expectedMs = FREEMIUM_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
      expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - expectedMs);
      expect(cutoff.getTime()).toBeLessThanOrEqual(after - expectedMs);

      expect(result.items[0]).toBeInstanceOf(ResumeHistoryItem);
      expect(result.total).toBe(1);
    });

    it('does not apply date filter for PREMIUM plan', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[makeEntity()], 1]);

      await service.getResumeGenerationHistoryPaginated('user-1', {
        plan: UserPlan.PREMIUM,
      });

      const cutoffCall = qbMock.andWhere.mock.calls.find(
        (args: any[]) =>
          typeof args[0] === 'string' && args[0].includes('created_at'),
      );
      expect(cutoffCall).toBeUndefined();
    });

    it('returns correct pagination shape', async () => {
      qbMock.getManyAndCount.mockResolvedValue([
        [makeEntity(), makeEntity({ id: 'gen-2' })],
        5,
      ]);

      const result = await service.getResumeGenerationHistoryPaginated(
        'user-1',
        { page: 2, limit: 2 },
      );

      expect(result.page).toBe(2);
      expect(result.limit).toBe(2);
      expect(result.total).toBe(5);
      expect(result.items).toHaveLength(2);
      result.items.forEach((item) =>
        expect(item).toBeInstanceOf(ResumeHistoryItem),
      );
    });
  });

  // ─── getResumeGenerationDetail ────────────────────────────────────────────

  describe('getResumeGenerationDetail', () => {
    it('returns a ResumeHistoryDetail instance', async () => {
      findOneMock.mockResolvedValue(makeEntity());

      const result = await service.getResumeGenerationDetail('gen-1', 'user-1');

      expect(result).toBeInstanceOf(ResumeHistoryDetail);
      expect(result.companyName).toBe('Acme');
      expect(result.achievementsQuantified).toBe(2);
      expect(result.changesDiff).toEqual({ before: 'x', after: 'y' });
      expect(result.canDownload).toBe(true);
    });

    it('throws NotFoundException when record is not found', async () => {
      findOneMock.mockResolvedValue(null);

      await expect(
        service.getResumeGenerationDetail('missing', 'user-1'),
      ).rejects.toThrow('Resume generation not found');
    });
  });
});
