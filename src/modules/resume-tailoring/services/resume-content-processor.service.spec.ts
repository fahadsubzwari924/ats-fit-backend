import { Test, TestingModule } from '@nestjs/testing';
import { ResumeContentProcessorService } from './resume-content-processor.service';
import { ResumeSelectionService } from '../../ats-match/services/resume-selection.service';
import { AIContentService } from '../../../shared/services/ai-content.service';
import { ResumeService } from './resume.service';
import { ResumeProfileEnrichmentService } from './resume-profile-enrichment.service';

// pdf-parse is used internally; mock it so tests don't need a real PDF buffer
jest.mock('pdf-parse', () =>
  jest.fn().mockResolvedValue({
    text: 'A'.repeat(200), // > 100 chars so extractTextFromFile passes the length guard
  }),
);

describe('ResumeContentProcessorService', () => {
  let service: ResumeContentProcessorService;
  let resumeSelectionService: jest.Mocked<ResumeSelectionService>;
  let aiContentService: jest.Mocked<AIContentService>;
  let resumeProfileEnrichmentService: jest.Mocked<ResumeProfileEnrichmentService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumeContentProcessorService,
        {
          provide: ResumeSelectionService,
          useValue: {
            selectResume: jest.fn(),
            getUserAvailableResumes: jest.fn(),
          },
        },
        {
          provide: AIContentService,
          useValue: {
            extractResumeContent: jest.fn(),
          },
        },
        {
          provide: ResumeService,
          useValue: {},
        },
        {
          provide: ResumeProfileEnrichmentService,
          useValue: {
            getProfile: jest.fn(),
            resolveTailoringContextForResume: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ResumeContentProcessorService>(
      ResumeContentProcessorService,
    );
    resumeSelectionService = module.get(ResumeSelectionService);
    aiContentService = module.get(AIContentService);
    void module.get(ResumeService); // provided for DI only, not exercised directly
    resumeProfileEnrichmentService = module.get(ResumeProfileEnrichmentService);
  });

  describe('rawContent field', () => {
    it('file upload path: rawContent equals content', async () => {
      const structuredContent = {
        summary: 'Software Engineer',
        skills: ['TypeScript', 'NestJS'],
      };

      // getUserAvailableResumes is called first; value doesn't matter here because
      // we supply a file so the code takes the file-upload branch regardless.
      (
        resumeSelectionService.getUserAvailableResumes as jest.Mock
      ).mockResolvedValue([]);
      (aiContentService.extractResumeContent as jest.Mock).mockResolvedValue(
        structuredContent,
      );

      const mockFile: Express.Multer.File = {
        fieldname: 'resume',
        originalname: 'resume.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        size: 5 * 1024, // 5 KB — passes min/max checks
        buffer: Buffer.from('fake pdf content'),
        destination: '',
        filename: '',
        path: '',
        stream: null as any,
      };

      const result = await service.processResumeContent(
        { userId: 'u1', userType: 'premium' },
        mockFile,
      );

      expect(result.rawContent).toEqual(structuredContent);
      expect(result.content).toEqual(structuredContent);
      expect(result.rawContent).toEqual(result.content);
    });

    it('enriched profile path: rawContent is originalContent, content is enrichedContent', async () => {
      const originalContent = { summary: 'original' };
      const enrichedContent = { summary: 'enriched' };

      (
        resumeSelectionService.getUserAvailableResumes as jest.Mock
      ).mockResolvedValue([{ resumeId: 'r1' }]);
      (resumeSelectionService.selectResume as jest.Mock).mockResolvedValue({
        resumeId: 'r1',
        extractedText: 'text',
        structuredContent: { summary: 'original' },
      });
      (
        resumeProfileEnrichmentService.resolveTailoringContextForResume as jest.Mock
      ).mockResolvedValue({ tailoringMode: 'enhanced', verifiedFacts: [] });
      (
        resumeProfileEnrichmentService.getProfile as jest.Mock
      ).mockResolvedValue({ originalContent, enrichedContent });

      const result = await service.processResumeContent({
        userId: 'u1',
        userType: 'premium',
      });

      expect(result.rawContent).toEqual({ summary: 'original' });
      expect(result.content).toEqual({ summary: 'enriched' });
      expect(result.rawContent).not.toEqual(result.content);
    });

    it('structured content path (no enriched profile): rawContent equals content', async () => {
      const structuredContent = { summary: 'structured' };

      (
        resumeSelectionService.getUserAvailableResumes as jest.Mock
      ).mockResolvedValue([{ resumeId: 'r1' }]);
      (resumeSelectionService.selectResume as jest.Mock).mockResolvedValue({
        resumeId: 'r1',
        extractedText: 'text',
        structuredContent,
      });
      (
        resumeProfileEnrichmentService.resolveTailoringContextForResume as jest.Mock
      ).mockResolvedValue({ tailoringMode: 'standard', verifiedFacts: [] });
      (
        resumeProfileEnrichmentService.getProfile as jest.Mock
      ).mockResolvedValue(null);

      const result = await service.processResumeContent({
        userId: 'u1',
        userType: 'premium',
      });

      expect(result.rawContent).toEqual({ summary: 'structured' });
      expect(result.content).toEqual({ summary: 'structured' });
      expect(result.rawContent).toEqual(result.content);
    });
  });
});
