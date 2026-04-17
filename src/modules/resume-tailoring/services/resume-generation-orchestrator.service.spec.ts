import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResumeGenerationOrchestratorService } from './resume-generation-orchestrator.service';
import { ResumeValidationService } from './resume-validation.service';
import { JobAnalysisService } from './job-analysis.service';
import { ResumeContentProcessorService } from './resume-content-processor.service';
import { ResumeOptimizerService } from './resume-optimizer.service';
import { PdfGenerationOrchestratorService } from './pdf-generation-orchestrator.service';
import { TailoredResumePdfStorageService } from './tailored-resume-pdf-storage.service';
import { ResumeQueueService } from './resume-queue.service';
import { AtsChecksComputationService } from './ats-checks-computation.service';
import { BulletsQuantifiedComputationService } from './bullets-quantified-computation.service';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';

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

  const mockResumeQueueService = {
    addChangesDiffJob: jest.fn(),
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
        { provide: ResumeQueueService, useValue: mockResumeQueueService },
        {
          provide: AtsChecksComputationService,
          useValue: mockAtsChecksComputationService,
        },
        {
          provide: BulletsQuantifiedComputationService,
          useValue: mockBulletsQuantifiedComputationService,
        },
        {
          provide: getRepositoryToken(ResumeGeneration),
          useValue: mockResumeGenerationRepository,
        },
      ],
    }).compile();

    service = module.get<ResumeGenerationOrchestratorService>(
      ResumeGenerationOrchestratorService,
    );
  });

  describe('generateOptimizedResume — diff job baseline', () => {
    it('should pass rawContent (not enriched content) as originalContent to addChangesDiffJob', async () => {
      // Arrange — distinct objects so we can assert which one was used
      const enrichedContent = { summary: 'enriched summary', experience: [] };
      const rawContent = { summary: 'raw summary', experience: [] };

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
        rawContent: rawContent,
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

      const savedRecord = { id: 'gen-uuid-123' };
      mockResumeGenerationRepository.create.mockReturnValue(savedRecord);
      mockResumeGenerationRepository.save.mockResolvedValue(savedRecord);

      mockResumeQueueService.addChangesDiffJob.mockResolvedValue(undefined);

      const input = {
        jobDescription: 'Build backend services',
        jobPosition: 'Senior Engineer',
        companyName: 'Acme Corp',
        templateId: 'template-1',
        resumeId: 'resume-uuid',
        userContext: { userId: 'user-uuid', isGuest: false },
      };

      // Act
      await service.generateOptimizedResume(input as any);

      // Allow the fire-and-forget void promise to settle
      await new Promise((resolve) => setImmediate(resolve));

      // Assert — addChangesDiffJob must have been called with rawContent as originalContent
      expect(mockResumeQueueService.addChangesDiffJob).toHaveBeenCalledWith(
        expect.objectContaining({
          originalContent: rawContent,
        }),
      );

      // Guard: enriched content must NOT be used as the diff baseline
      const callArg = mockResumeQueueService.addChangesDiffJob.mock.calls[0][0];
      expect(callArg.originalContent).not.toBe(enrichedContent);
      expect(callArg.originalContent).toEqual({
        summary: 'raw summary',
        experience: [],
      });
    });
  });
});
