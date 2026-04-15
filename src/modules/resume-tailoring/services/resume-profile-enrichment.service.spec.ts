import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResumeProfileEnrichmentService } from './resume-profile-enrichment.service';
import { EnrichedResumeProfile } from '../../../database/entities/enriched-resume-profile.entity';
import { TailoringQuestion } from '../../../database/entities/tailoring-session.entity';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { ClaudeService } from '../../../shared/modules/external/services/claude.service';
import { PromptService } from '../../../shared/services/prompt.service';

describe('ResumeProfileEnrichmentService', () => {
  let service: ResumeProfileEnrichmentService;
  let questionFind: jest.Mock;

  const userId = '11111111-1111-1111-1111-111111111111';
  const resumeId = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    questionFind = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumeProfileEnrichmentService,
        {
          provide: getRepositoryToken(EnrichedResumeProfile),
          useValue: {},
        },
        {
          provide: getRepositoryToken(TailoringQuestion),
          useValue: { find: questionFind },
        },
        {
          provide: getRepositoryToken(ExtractedResumeContent),
          useValue: {},
        },
        { provide: ClaudeService, useValue: {} },
        { provide: PromptService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('claude-haiku-4-5-20251001'),
          },
        },
      ],
    }).compile();

    service = module.get(ResumeProfileEnrichmentService);
  });

  describe('resolveTailoringContextForResume', () => {
    it('returns standard with empty facts when userId is missing', async () => {
      const r = await service.resolveTailoringContextForResume('', resumeId);
      expect(r).toEqual({ verifiedFacts: [], tailoringMode: 'standard' });
      expect(questionFind).not.toHaveBeenCalled();
    });

    it('returns standard with empty facts when no profile questions exist', async () => {
      questionFind
        .mockResolvedValueOnce([]) // getAnsweredProfileFacts
        .mockResolvedValueOnce([]); // stats query

      const r = await service.resolveTailoringContextForResume(
        userId,
        resumeId,
      );
      expect(r.tailoringMode).toBe('standard');
      expect(r.verifiedFacts).toEqual([]);
    });

    it('returns enhanced with facts when some questions answered with text', async () => {
      const answeredRow: Partial<TailoringQuestion> = {
        originalBulletPoint: 'Led team',
        userResponse: 'Team of 5',
        isAnswered: true,
      };
      const allRows: Partial<TailoringQuestion>[] = [
        { ...answeredRow, isAnswered: true },
        { isAnswered: false },
        { isAnswered: false },
      ];

      questionFind
        .mockResolvedValueOnce([answeredRow])
        .mockResolvedValueOnce(allRows as TailoringQuestion[]);

      const r = await service.resolveTailoringContextForResume(
        userId,
        resumeId,
      );
      expect(r.tailoringMode).toBe('enhanced');
      expect(r.verifiedFacts).toEqual([
        { originalBulletPoint: 'Led team', userResponse: 'Team of 5' },
      ]);
    });

    it('returns precision when all questions are answered', async () => {
      const rows: Partial<TailoringQuestion>[] = [
        {
          originalBulletPoint: 'a',
          userResponse: 'x',
          isAnswered: true,
        },
        {
          originalBulletPoint: 'b',
          userResponse: 'y',
          isAnswered: true,
        },
      ];

      questionFind
        .mockResolvedValueOnce(rows as TailoringQuestion[])
        .mockResolvedValueOnce(rows as TailoringQuestion[]);

      const r = await service.resolveTailoringContextForResume(
        userId,
        resumeId,
      );
      expect(r.tailoringMode).toBe('precision');
      expect(r.verifiedFacts).toHaveLength(2);
    });

    it('returns precision with empty verifiedFacts when responses are whitespace only', async () => {
      const rows: Partial<TailoringQuestion>[] = [
        { originalBulletPoint: 'a', userResponse: '   ', isAnswered: true },
      ];

      questionFind
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(rows as TailoringQuestion[]);

      const r = await service.resolveTailoringContextForResume(
        userId,
        resumeId,
      );
      expect(r.verifiedFacts).toEqual([]);
      expect(r.tailoringMode).toBe('precision');
    });
  });
});
