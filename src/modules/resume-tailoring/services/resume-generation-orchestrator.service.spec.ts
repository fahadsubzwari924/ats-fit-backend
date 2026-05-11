import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResumeGenerationOrchestratorService } from './resume-generation-orchestrator.service';
import { ResumeValidationService } from './resume-validation.service';
import { JobAnalysisService } from './job-analysis.service';
import { ResumeContentProcessorService } from './resume-content-processor.service';
import { ResumeOptimizerService } from './resume-optimizer.service';
import { PdfGenerationOrchestratorService } from './pdf-generation-orchestrator.service';
import { TailoredResumePdfStorageService } from './tailored-resume-pdf-storage.service';
import { AtsChecksComputationService } from './ats-checks-computation.service';
import { BulletsQuantifiedComputationService } from './bullets-quantified-computation.service';
import { ChangesDiffComputationService } from './changes-diff-computation.service';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { User } from '../../../database/entities/user.entity';
import { ResumeContentService } from './resume-content.service';

describe('ResumeGenerationOrchestratorService', () => {
  let service: ResumeGenerationOrchestratorService;

  const mockValidatorService = {
    validateGenerationRequest: jest.fn(),
  };

  const mockJobAnalysisService = {
    analyzeJobDescription: jest.fn(),
  };

  const mockResumeContentProcessorService = {
    processResumeContent: jest.fn(),
  };

  const mockResumeOptimizerService = {
    optimizeResumeContent: jest.fn(),
  };

  const mockPdfGenerationOrchestratorService = {
    generateOptimizedResumePdf: jest.fn(),
  };

  const mockTailoredResumePdfStorageService = {
    uploadGeneratedPdf: jest.fn(),
  };

  const mockResumeGenerationRepository = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockAtsChecksComputationService = {
    computeChecks: jest
      .fn()
      .mockReturnValue({ passed: 8, total: 10, failures: [] }),
  };

  const mockBulletsQuantifiedComputationService = {
    computeQuantified: jest
      .fn()
      .mockReturnValue({ before: 2, after: 5, total: 10 }),
  };

  const mockChangesDiffComputationService = {
    computeDiff: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumeGenerationOrchestratorService,
        { provide: ResumeValidationService, useValue: mockValidatorService },
        { provide: JobAnalysisService, useValue: mockJobAnalysisService },
        {
          provide: ResumeContentProcessorService,
          useValue: mockResumeContentProcessorService,
        },
        {
          provide: ResumeOptimizerService,
          useValue: mockResumeOptimizerService,
        },
        {
          provide: PdfGenerationOrchestratorService,
          useValue: mockPdfGenerationOrchestratorService,
        },
        {
          provide: TailoredResumePdfStorageService,
          useValue: mockTailoredResumePdfStorageService,
        },
        {
          provide: AtsChecksComputationService,
          useValue: mockAtsChecksComputationService,
        },
        {
          provide: BulletsQuantifiedComputationService,
          useValue: mockBulletsQuantifiedComputationService,
        },
        {
          provide: ChangesDiffComputationService,
          useValue: mockChangesDiffComputationService,
        },
        {
          provide: getRepositoryToken(ResumeGeneration),
          useValue: mockResumeGenerationRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: { findOne: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: ResumeContentService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<ResumeGenerationOrchestratorService>(
      ResumeGenerationOrchestratorService,
    );
  });

  describe('generateOptimizedResume — inline diff', () => {
    it('should compute diff synchronously and persist changes_diff in the saved record', async () => {
      // Arrange
      const enrichedContent = { summary: 'enriched summary', experience: [] };

      mockValidatorService.validateGenerationRequest.mockResolvedValue({
        isValid: true,
        validationErrors: [],
        templateExists: true,
        hasExistingResumes: true,
        requiresFileUpload: false,
      });

      mockJobAnalysisService.analyzeJobDescription.mockResolvedValue({
        keywords: { primary: ['TypeScript', 'NestJS'] },
        technical: { mandatorySkills: ['Node.js'] },
      });

      mockResumeContentProcessorService.processResumeContent.mockResolvedValue({
        content: enrichedContent,
        rawContent: { summary: 'raw summary', experience: [] },
        source: 'database_existing',
        originalText: 'raw text',
        tailoringMode: 'enhanced',
        metadata: { extractionMethod: 'database_enriched_profile' },
      });

      const optimizedContent = {
        summary: 'optimized summary',
        experience: [{ role: 'Engineer' }],
      };
      mockResumeOptimizerService.optimizeResumeContent.mockResolvedValue({
        optimizedContent,
        optimizationMetrics: {
          keywordsAdded: 3,
          sectionsOptimized: 2,
          achievementsQuantified: 1,
          confidenceScore: 90,
        },
      });

      mockPdfGenerationOrchestratorService.generateOptimizedResumePdf.mockResolvedValue(
        {
          pdfContent: Buffer.from('fake-pdf').toString('base64'),
          filename: 'resume.pdf',
          generationMetadata: { pdfSizeBytes: 1024 },
        },
      );

      mockTailoredResumePdfStorageService.uploadGeneratedPdf.mockResolvedValue(
        's3/key/resume.pdf',
      );

      const fakeDiff = {
        version: 2 as const,
        totalChanges: 5,
        sectionsChanged: 3,
        computedAt: new Date().toISOString(),
        summary: null,
        skills: null,
        experience: [],
        keywordAnalysis: {
          targetKeywords: ['TypeScript', 'NestJS', 'Node.js'],
          originalMatches: ['TypeScript'],
          newlyAdded: ['NestJS', 'Node.js'],
          stillMissing: [],
          coverageOriginal: 33,
          coverageOptimized: 100,
        },
        changes: [],
      };
      mockChangesDiffComputationService.computeDiff.mockReturnValue(fakeDiff);

      const savedRecord = { id: 'gen-uuid-123' };
      mockResumeGenerationRepository.create.mockReturnValue(savedRecord);
      mockResumeGenerationRepository.save.mockResolvedValue(savedRecord);

      const input = {
        jobDescription: 'Build backend services',
        jobPosition: 'Senior Engineer',
        companyName: 'Acme Corp',
        templateId: 'template-1',
        resumeId: 'resume-uuid',
        userContext: { userId: 'user-uuid', isGuest: false },
      };

      // Act
      const result = await service.generateOptimizedResume(input as any);

      // Assert — computeDiff was called synchronously (before save)
      expect(
        mockChangesDiffComputationService.computeDiff,
      ).toHaveBeenCalledWith(enrichedContent, optimizedContent, {
        mandatorySkills: ['Node.js'],
        primaryKeywords: ['TypeScript', 'NestJS'],
      });

      // Assert — changes_diff is persisted in the save record (not null)
      const savedPayload =
        mockResumeGenerationRepository.create.mock.calls[0][0];
      expect(savedPayload.changes_diff).toEqual(fakeDiff);

      // Assert — keywordsAdded in result derives from diff.keywordAnalysis.newlyAdded.length
      expect(result.keywordsAdded).toBe(2);

      // Assert — sectionsChanged in result derives from diff.sectionsChanged
      expect(result.sectionsChanged).toBe(3);
    });
  });
});
