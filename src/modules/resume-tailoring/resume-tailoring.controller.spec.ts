import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { ResumeTailoringController } from './resume-tailoring.controller';
import { ResumeTemplateService } from './services/resume-templates.service';
import { ResumeGenerationOrchestratorService } from './services/resume-generation-orchestrator.service';
import { ResumeService } from './services/resume.service';
import { CoverLetterGenerationService } from './services/cover-letter-generation.service';
import {
  BadRequestException,
  ForbiddenException,
} from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { BatchGenerateDto, BatchJobItemDto } from './dtos/batch-generate.dto';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { UserContext } from '../../modules/auth/types/user-context.type';
import { ResumeGenerationResult } from './interfaces/resume-generation.interface';
import { PremiumUserGuard } from '../auth/guards/premium-user.guard';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { Reflector } from '@nestjs/core';

describe('ResumeTailoringController - Batch Resume Tailoring Limit', () => {
  let controller: ResumeTailoringController;
  let resumeGenerationOrchestratorService: jest.Mocked<ResumeGenerationOrchestratorService>;

  const mockUserContext: UserContext = {
    userId: '11111111-1111-1111-1111-111111111111',
    userType: 'authenticated',
    isPremium: true,
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
  };

  const mockRequest: Partial<RequestWithUserContext> = {
    userContext: mockUserContext,
  };

  const createMockJobItem = (
    jobPosition: string,
    companyName: string,
    jobDescription?: string,
  ): BatchJobItemDto => ({
    jobPosition,
    companyName,
    jobDescription:
      jobDescription ||
      'This is a detailed job description that meets minimum length requirements.',
  });

  beforeEach(async () => {
    const mockResumeTemplateService = {
      getResumeTemplates: jest.fn(),
    };

    const mockResumeGenerationOrchestratorService = {
      generateOptimizedResume: jest.fn(),
    };

    const mockResumeService = {
      getResumeGenerationHistory: jest.fn(),
      getResumeGenerationHistoryPaginated: jest.fn(),
      getResumeGenerationDetail: jest.fn(),
      downloadResumeGeneration: jest.fn(),
      getChangesDiff: jest.fn(),
    };

    const mockCoverLetterGenerationService = {
      generateFromResumeGeneration: jest.fn(),
      generateStandalone: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResumeTailoringController],
      providers: [
        {
          provide: ResumeTemplateService,
          useValue: mockResumeTemplateService,
        },
        {
          provide: ResumeGenerationOrchestratorService,
          useValue: mockResumeGenerationOrchestratorService,
        },
        {
          provide: ResumeService,
          useValue: mockResumeService,
        },
        {
          provide: CoverLetterGenerationService,
          useValue: mockCoverLetterGenerationService,
        },
      ],
    }).compile();

    controller = module.get<ResumeTailoringController>(
      ResumeTailoringController,
    );
    resumeGenerationOrchestratorService = module.get(
      ResumeGenerationOrchestratorService,
    );
  });

  describe('Batch Resume Limit Validation', () => {
    describe('Should accept valid job counts (1-3)', () => {
      it('should process batch request with 1 job successfully', async () => {
        const dto: BatchGenerateDto = {
          jobs: [createMockJobItem('Senior Developer', 'Google')],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        const mockResult: ResumeGenerationResult = {
          resumeGenerationId: 'gen-1',
          pdfContent: 'base64-pdf-content',
          filename: 'resume-1.pdf',
          optimizationConfidence: 85,
          keywordsAdded: 5,
          tailoringMode: 'enhanced',
          sectionsOptimized: 3,
          achievementsQuantified: 2,
          processingMetrics: {
            validationTimeMs: 10,
            parallelOperationsTimeMs: 100,
            optimizationTimeMs: 50,
            pdfGenerationTimeMs: 30,
            dbSaveTimeMs: 5,
            totalProcessingTimeMs: 195,
          },
          contentSource: 'database_extraction',
          pdfSizeBytes: 50000,
          templateUsed: 'standard',
          primaryKeywordsFound: 8,
          mandatorySkillsAligned: 5,
        };

        resumeGenerationOrchestratorService.generateOptimizedResume.mockResolvedValueOnce(
          mockResult,
        );

        const result = await controller.batchGenerateTailoredResumes(
          dto,
          mockRequest as RequestWithUserContext,
        );

        expect(result.summary.total).toBe(1);
        expect(result.summary.succeeded).toBe(1);
        expect(result.summary.failed).toBe(0);
        expect(result.results).toHaveLength(1);
        expect(result.results[0].status).toBe('success');
        expect(
          resumeGenerationOrchestratorService.generateOptimizedResume,
        ).toHaveBeenCalledTimes(1);
      });

      it('should process batch request with 2 jobs successfully', async () => {
        const dto: BatchGenerateDto = {
          jobs: [
            createMockJobItem('Senior Frontend Engineer', 'Meta'),
            createMockJobItem('Full Stack Developer', 'Apple'),
          ],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        const mockResult: ResumeGenerationResult = {
          resumeGenerationId: 'gen-id',
          pdfContent: 'base64-pdf-content',
          filename: 'resume.pdf',
          optimizationConfidence: 90,
          keywordsAdded: 8,
          tailoringMode: 'enhanced',
          sectionsOptimized: 4,
          achievementsQuantified: 3,
          processingMetrics: {
            validationTimeMs: 10,
            parallelOperationsTimeMs: 100,
            optimizationTimeMs: 50,
            pdfGenerationTimeMs: 30,
            dbSaveTimeMs: 5,
            totalProcessingTimeMs: 195,
          },
          contentSource: 'database_extraction',
          pdfSizeBytes: 55000,
          templateUsed: 'standard',
          primaryKeywordsFound: 10,
          mandatorySkillsAligned: 6,
        };

        resumeGenerationOrchestratorService.generateOptimizedResume.mockResolvedValue(
          mockResult,
        );

        const result = await controller.batchGenerateTailoredResumes(
          dto,
          mockRequest as RequestWithUserContext,
        );

        expect(result.summary.total).toBe(2);
        expect(result.summary.succeeded).toBe(2);
        expect(result.summary.failed).toBe(0);
        expect(result.results).toHaveLength(2);
        expect(
          resumeGenerationOrchestratorService.generateOptimizedResume,
        ).toHaveBeenCalledTimes(2);
      });

      it('should process batch request with 3 jobs (boundary value) successfully', async () => {
        const dto: BatchGenerateDto = {
          jobs: [
            createMockJobItem('Senior DevOps Engineer', 'Netflix'),
            createMockJobItem('Cloud Architect', 'AWS'),
            createMockJobItem('Infrastructure Engineer', 'Microsoft'),
          ],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        const mockResult: ResumeGenerationResult = {
          resumeGenerationId: 'gen-id',
          pdfContent: 'base64-pdf-content',
          filename: 'resume.pdf',
          optimizationConfidence: 95,
          keywordsAdded: 12,
          tailoringMode: 'precision',
          sectionsOptimized: 5,
          achievementsQuantified: 4,
          processingMetrics: {
            validationTimeMs: 10,
            parallelOperationsTimeMs: 100,
            optimizationTimeMs: 50,
            pdfGenerationTimeMs: 30,
            dbSaveTimeMs: 5,
            totalProcessingTimeMs: 195,
          },
          contentSource: 'database_extraction',
          pdfSizeBytes: 60000,
          templateUsed: 'standard',
          primaryKeywordsFound: 15,
          mandatorySkillsAligned: 8,
        };

        resumeGenerationOrchestratorService.generateOptimizedResume.mockResolvedValue(
          mockResult,
        );

        const result = await controller.batchGenerateTailoredResumes(
          dto,
          mockRequest as RequestWithUserContext,
        );

        expect(result.summary.total).toBe(3);
        expect(result.summary.succeeded).toBe(3);
        expect(result.summary.failed).toBe(0);
        expect(result.results).toHaveLength(3);
        expect(
          resumeGenerationOrchestratorService.generateOptimizedResume,
        ).toHaveBeenCalledTimes(3);
      });
    });

    describe('Should reject invalid job counts (4+)', () => {
      it('should reject batch request with 4 jobs', async () => {
        const dto: BatchGenerateDto = {
          jobs: [
            createMockJobItem('Engineer 1', 'Company 1'),
            createMockJobItem('Engineer 2', 'Company 2'),
            createMockJobItem('Engineer 3', 'Company 3'),
            createMockJobItem('Engineer 4', 'Company 4'),
          ],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        await expect(
          controller.batchGenerateTailoredResumes(
            dto,
            mockRequest as RequestWithUserContext,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should reject batch request with 10 jobs', async () => {
        const dto: BatchGenerateDto = {
          jobs: Array.from({ length: 10 }, (_, i) => ({
            jobPosition: `Senior Engineer ${i + 1}`,
            companyName: `Company ${i + 1}`,
            jobDescription:
              'This is a detailed job description that meets minimum length requirements.',
          })),
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        await expect(
          controller.batchGenerateTailoredResumes(
            dto,
            mockRequest as RequestWithUserContext,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should reject batch request with 5 jobs', async () => {
        const dto: BatchGenerateDto = {
          jobs: Array.from({ length: 5 }, (_, i) => ({
            jobPosition: `Developer ${i + 1}`,
            companyName: `Tech Corp ${i + 1}`,
            jobDescription:
              'This is a detailed job description that meets minimum length requirements.',
          })),
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        await expect(
          controller.batchGenerateTailoredResumes(
            dto,
            mockRequest as RequestWithUserContext,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('should reject batch request with 50 jobs', async () => {
        const dto: BatchGenerateDto = {
          jobs: Array.from({ length: 50 }, (_, i) => ({
            jobPosition: `Role ${i + 1}`,
            companyName: `Company ${i + 1}`,
            jobDescription:
              'This is a detailed job description that meets minimum length requirements.',
          })),
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        await expect(
          controller.batchGenerateTailoredResumes(
            dto,
            mockRequest as RequestWithUserContext,
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('Should return correct error response', () => {
      it('should throw BadRequestException with correct error code when exceeding limit', async () => {
        const dto: BatchGenerateDto = {
          jobs: [
            createMockJobItem('Engineer 1', 'Company 1'),
            createMockJobItem('Engineer 2', 'Company 2'),
            createMockJobItem('Engineer 3', 'Company 3'),
            createMockJobItem('Engineer 4', 'Company 4'),
          ],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        try {
          await controller.batchGenerateTailoredResumes(
            dto,
            mockRequest as RequestWithUserContext,
          );
          fail('Should have thrown BadRequestException');
        } catch (error) {
          expect(error).toBeInstanceOf(BadRequestException);
          const response = error.getResponse?.();
          expect(response?.errorCode).toBe(ERROR_CODES.BATCH_LIMIT_EXCEEDED);
        }
      });

      it('should include correct error message when exceeding limit', async () => {
        const dto: BatchGenerateDto = {
          jobs: [
            createMockJobItem('Job 1', 'Org 1'),
            createMockJobItem('Job 2', 'Org 2'),
            createMockJobItem('Job 3', 'Org 3'),
            createMockJobItem('Job 4', 'Org 4'),
          ],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        try {
          await controller.batchGenerateTailoredResumes(
            dto,
            mockRequest as RequestWithUserContext,
          );
          fail('Should have thrown BadRequestException');
        } catch (error) {
          expect((error as BadRequestException).message).toContain(
            'Maximum 3 resumes allowed per batch request',
          );
        }
      });

      it('should not throw exception before checking limit when invalid user', async () => {
        const requestWithoutUser: Partial<RequestWithUserContext> = {
          userContext: {
            userId: '',
            userType: 'guest',
            ipAddress: '127.0.0.1',
            userAgent: 'test-agent',
          },
        };

        const dto: BatchGenerateDto = {
          jobs: [
            createMockJobItem('Job 1', 'Org 1'),
            createMockJobItem('Job 2', 'Org 2'),
            createMockJobItem('Job 3', 'Org 3'),
            createMockJobItem('Job 4', 'Org 4'),
          ],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        await expect(
          controller.batchGenerateTailoredResumes(
            dto,
            requestWithoutUser as RequestWithUserContext,
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('Should handle mixed success/failure scenarios with valid count', () => {
      it('should handle partial failures when some jobs fail (within limit)', async () => {
        const dto: BatchGenerateDto = {
          jobs: [
            createMockJobItem('Successful Job', 'Company A'),
            createMockJobItem('Failing Job', 'Company B'),
            createMockJobItem('Successful Job 2', 'Company C'),
          ],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        const mockSuccessResult: ResumeGenerationResult = {
          resumeGenerationId: 'gen-success',
          pdfContent: 'base64-pdf-content',
          filename: 'resume.pdf',
          optimizationConfidence: 85,
          keywordsAdded: 5,
          tailoringMode: 'enhanced',
          sectionsOptimized: 3,
          achievementsQuantified: 2,
          processingMetrics: {
            validationTimeMs: 10,
            parallelOperationsTimeMs: 100,
            optimizationTimeMs: 50,
            pdfGenerationTimeMs: 30,
            dbSaveTimeMs: 5,
            totalProcessingTimeMs: 195,
          },
          contentSource: 'database_extraction',
          pdfSizeBytes: 50000,
          templateUsed: 'standard',
          primaryKeywordsFound: 8,
          mandatorySkillsAligned: 5,
        };

        resumeGenerationOrchestratorService.generateOptimizedResume
          .mockResolvedValueOnce(mockSuccessResult)
          .mockRejectedValueOnce(new Error('Generation failed'))
          .mockResolvedValueOnce(mockSuccessResult);

        const result = await controller.batchGenerateTailoredResumes(
          dto,
          mockRequest as RequestWithUserContext,
        );

        expect(result.summary.total).toBe(3);
        expect(result.summary.succeeded).toBe(2);
        expect(result.summary.failed).toBe(1);
        expect(
          result.results.filter((r) => r.status === 'success'),
        ).toHaveLength(2);
        expect(
          result.results.filter((r) => r.status === 'failed'),
        ).toHaveLength(1);
      });
    });

    describe('Edge cases and boundary conditions', () => {
      it('should reject exactly at the boundary (3 is accepted, 4 is rejected)', async () => {
        // Test 3 jobs - should pass
        const dtoValid: BatchGenerateDto = {
          jobs: [
            createMockJobItem('Job 1', 'Org 1'),
            createMockJobItem('Job 2', 'Org 2'),
            createMockJobItem('Job 3', 'Org 3'),
          ],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        const mockResult: ResumeGenerationResult = {
          resumeGenerationId: 'gen-id',
          pdfContent: 'base64-content',
          filename: 'resume.pdf',
          optimizationConfidence: 85,
          keywordsAdded: 5,
          tailoringMode: 'enhanced',
          sectionsOptimized: 3,
          achievementsQuantified: 2,
          processingMetrics: {
            validationTimeMs: 10,
            parallelOperationsTimeMs: 100,
            optimizationTimeMs: 50,
            pdfGenerationTimeMs: 30,
            dbSaveTimeMs: 5,
            totalProcessingTimeMs: 195,
          },
          contentSource: 'database_extraction',
          pdfSizeBytes: 50000,
          templateUsed: 'standard',
          primaryKeywordsFound: 8,
          mandatorySkillsAligned: 5,
        };

        resumeGenerationOrchestratorService.generateOptimizedResume.mockResolvedValue(
          mockResult,
        );

        // 3 jobs should succeed
        const validResult = await controller.batchGenerateTailoredResumes(
          dtoValid,
          mockRequest as RequestWithUserContext,
        );
        expect(validResult.summary.succeeded).toBe(3);

        // Reset mocks
        resumeGenerationOrchestratorService.generateOptimizedResume.mockClear();

        // Test 4 jobs - should fail
        const dtoInvalid: BatchGenerateDto = {
          jobs: [
            createMockJobItem('Job 1', 'Org 1'),
            createMockJobItem('Job 2', 'Org 2'),
            createMockJobItem('Job 3', 'Org 3'),
            createMockJobItem('Job 4', 'Org 4'),
          ],
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        // 4 jobs should fail
        await expect(
          controller.batchGenerateTailoredResumes(
            dtoInvalid,
            mockRequest as RequestWithUserContext,
          ),
        ).rejects.toThrow(BadRequestException);

        // Ensure generateOptimizedResume was never called for the 4-job request
        expect(
          resumeGenerationOrchestratorService.generateOptimizedResume,
        ).not.toHaveBeenCalled();
      });

      it('should validate limit before processing any jobs', async () => {
        const dtoInvalid: BatchGenerateDto = {
          jobs: Array.from({ length: 7 }, (_, i) => ({
            jobPosition: `Role ${i + 1}`,
            companyName: `Company ${i + 1}`,
            jobDescription:
              'This is a detailed job description that meets minimum length requirements.',
          })),
          templateId: 'template-1',
          resumeId: 'resume-1',
        };

        await expect(
          controller.batchGenerateTailoredResumes(
            dtoInvalid,
            mockRequest as RequestWithUserContext,
          ),
        ).rejects.toThrow(BadRequestException);

        // Verify no job processing was attempted
        expect(
          resumeGenerationOrchestratorService.generateOptimizedResume,
        ).not.toHaveBeenCalled();
      });
    });

    describe('PremiumUserGuard and RateLimitGuard batch-route access control', () => {
      const buildContext = (
        userCtx: Partial<UserContext>,
      ): ExecutionContext => {
        const request = { userContext: userCtx } as RequestWithUserContext;
        return {
          switchToHttp: () => ({ getRequest: () => request }),
          getHandler: () => ({}),
          getClass: () => ({}),
        } as unknown as ExecutionContext;
      };

      it('should block FREEMIUM user with 403 ForbiddenException (PremiumUserGuard)', () => {
        const guard = new PremiumUserGuard();
        const ctx = buildContext({
          userId: 'freemium-user-id',
          userType: 'authenticated',
          isPremium: false,
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        });

        expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
        try {
          guard.canActivate(ctx);
        } catch (error) {
          expect(error).toBeInstanceOf(ForbiddenException);
          const response = (
            error as ForbiddenException
          ).getResponse?.() as Record<string, unknown>;
          expect(response?.errorCode).toBe(ERROR_CODES.PREMIUM_REQUIRED);
        }
      });

      it('should allow PREMIUM user within rate limit to reach the handler', async () => {
        // PremiumUserGuard passes for isPremium === true
        const guard = new PremiumUserGuard();
        const ctx = buildContext({
          userId: 'premium-user-id',
          userType: 'authenticated',
          isPremium: true,
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        });

        const result = guard.canActivate(ctx);
        expect(result).toBe(true);

        // RateLimitGuard passes when rateLimitService.checkRateLimit returns allowed
        const mockRateLimitService = {
          checkRateLimit: jest.fn().mockResolvedValue({
            allowed: true,
            currentUsage: 0,
            limit: 3,
            remaining: 3,
            resetDate: new Date(),
          }),
        } as unknown as RateLimitService;

        const mockReflector = {
          get: jest.fn().mockReturnValue('RESUME_BATCH_GENERATION'),
        } as unknown as Reflector;

        const rateLimitGuard = new RateLimitGuard(
          mockReflector,
          mockRateLimitService,
        );
        const rateLimitCtx = buildContext({
          userId: 'premium-user-id',
          userType: 'authenticated',
          isPremium: true,
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        });

        const rateLimitResult = await rateLimitGuard.canActivate(rateLimitCtx);
        expect(rateLimitResult).toBe(true);
        expect(mockRateLimitService.checkRateLimit).toHaveBeenCalledTimes(1);
      });

      it('should block PREMIUM user who has exceeded rate limit with ForbiddenException', async () => {
        const mockRateLimitService = {
          checkRateLimit: jest.fn().mockResolvedValue({
            allowed: false,
            currentUsage: 3,
            limit: 3,
            remaining: 0,
            resetDate: new Date(),
          }),
        } as unknown as RateLimitService;

        const mockReflector = {
          get: jest.fn().mockReturnValue('RESUME_BATCH_GENERATION'),
        } as unknown as Reflector;

        const rateLimitGuard = new RateLimitGuard(
          mockReflector,
          mockRateLimitService,
        );
        const ctx = buildContext({
          userId: 'premium-user-id',
          userType: 'authenticated',
          isPremium: true,
          ipAddress: '127.0.0.1',
          userAgent: 'test-agent',
        });

        await expect(rateLimitGuard.canActivate(ctx)).rejects.toThrow(
          ForbiddenException,
        );

        try {
          await rateLimitGuard.canActivate(ctx);
        } catch (error) {
          expect(error).toBeInstanceOf(ForbiddenException);
          const response = (
            error as ForbiddenException
          ).getResponse?.() as Record<string, unknown>;
          expect(response?.errorCode).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
        }
      });
    });

    describe('Parameterized tests for job counts', () => {
      it.each([1, 2, 3])(
        'should accept batch with %i job(s)',
        async (jobCount) => {
          const jobs = Array.from({ length: jobCount }, (_, i) => ({
            jobPosition: `Role ${i + 1}`,
            companyName: `Company ${i + 1}`,
            jobDescription:
              'This is a detailed job description that meets minimum length requirements.',
          }));

          const dto: BatchGenerateDto = {
            jobs,
            templateId: 'template-1',
            resumeId: 'resume-1',
          };

          const mockResult: ResumeGenerationResult = {
            resumeGenerationId: 'gen-id',
            pdfContent: 'base64-content',
            filename: 'resume.pdf',
            optimizationConfidence: 85,
            keywordsAdded: 5,
            tailoringMode: 'enhanced',
            sectionsOptimized: 3,
            achievementsQuantified: 2,
            processingMetrics: {
              validationTimeMs: 10,
              parallelOperationsTimeMs: 100,
              optimizationTimeMs: 50,
              pdfGenerationTimeMs: 30,
              dbSaveTimeMs: 5,
              totalProcessingTimeMs: 195,
            },
            contentSource: 'database_extraction',
            pdfSizeBytes: 50000,
            templateUsed: 'standard',
            primaryKeywordsFound: 8,
            mandatorySkillsAligned: 5,
          };

          resumeGenerationOrchestratorService.generateOptimizedResume.mockResolvedValue(
            mockResult,
          );

          const result = await controller.batchGenerateTailoredResumes(
            dto,
            mockRequest as RequestWithUserContext,
          );

          expect(result.summary.total).toBe(jobCount);
          expect(result.summary.succeeded).toBe(jobCount);
          expect(result.summary.failed).toBe(0);
        },
      );

      it.each([4, 5, 10, 50])(
        'should reject batch with %i job(s)',
        async (jobCount) => {
          const jobs = Array.from({ length: jobCount }, (_, i) => ({
            jobPosition: `Role ${i + 1}`,
            companyName: `Company ${i + 1}`,
            jobDescription:
              'This is a detailed job description that meets minimum length requirements.',
          }));

          const dto: BatchGenerateDto = {
            jobs,
            templateId: 'template-1',
            resumeId: 'resume-1',
          };

          await expect(
            controller.batchGenerateTailoredResumes(
              dto,
              mockRequest as RequestWithUserContext,
            ),
          ).rejects.toThrow(BadRequestException);

          expect(
            resumeGenerationOrchestratorService.generateOptimizedResume,
          ).not.toHaveBeenCalled();
        },
      );
    });
  });
});
