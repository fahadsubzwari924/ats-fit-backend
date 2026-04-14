import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Logger,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ResumeTemplateService } from './services/resume-templates.service';
import { ResumeService } from './services/resume.service';
import { CoverLetterGenerationService } from './services/cover-letter-generation.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { GenerateTailoredResumeDto } from './dtos/generate-tailored-resume.dto';
import { GenerateCoverLetterDto } from './dtos/generate-cover-letter.dto';
import {
  BatchGenerateDto,
  BatchGenerateResponse,
  BatchJobResult,
} from './dtos/batch-generate.dto';
import { FileValidationPipe } from '../../shared/pipes/file-validation.pipe';
import { ResumeGenerationOrchestratorService } from './services/resume-generation-orchestrator.service';
import type { UserContext as ResumeUserContext } from './interfaces/user-context.interface';
import { ValidationLoggingInterceptor } from './interceptors/validation-logging.interceptor';
import {
  NotFoundException,
  BadRequestException,
} from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { RateLimitFeature } from '../rate-limit/rate-limit.guard';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { PremiumUserGuard } from '../auth/guards/premium-user.guard';
import { UserPlan } from '../../database/entities/user.entity';
import { Public } from '../auth/decorators/public.decorator';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { TransformUserContext } from '../../shared/decorators/transform-user-context.decorator';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { BULK_TAILORING_MAX_RESUMES } from '../../shared/constants/resume-tailoring.constants';

@ApiTags('Resume Tailoring')
@Controller('resume-tailoring')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ResumeTailoringController {
  private readonly logger = new Logger(ResumeTailoringController.name);

  constructor(
    private readonly resumeTemplateService: ResumeTemplateService,
    private readonly resumeGenerationOrchestratorService: ResumeGenerationOrchestratorService,
    private readonly resumeService: ResumeService,
    private readonly coverLetterGenerationService: CoverLetterGenerationService,
  ) {}

  @Get('templates')
  @Public()
  async getTemplates() {
    const templates = await this.resumeTemplateService.getResumeTemplates();
    return templates;
  }

  @Get('history')
  @TransformUserContext()
  async getResumeHistory(
    @Req() req: RequestWithUserContext,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    const userId = req.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    const rawPlan = req.userContext?.plan;
    const plan = Object.values(UserPlan).includes(rawPlan as UserPlan)
      ? (rawPlan as UserPlan)
      : undefined;

    if (page !== undefined) {
      return this.resumeService.getResumeGenerationHistoryPaginated(userId, {
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit ?? '10', 10) || 10,
        search,
        sortOrder: sortOrder ?? 'DESC',
        plan,
      });
    }

    return this.resumeService.getResumeGenerationHistory(
      userId,
      parseInt(limit ?? '10', 10) || 10,
      plan,
    );
  }

  @Get('history/:generationId')
  @TransformUserContext()
  async getResumeHistoryDetail(
    @Param('generationId') generationId: string,
    @Req() req: RequestWithUserContext,
  ) {
    const userId = req.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }
    return this.resumeService.getResumeGenerationDetail(generationId, userId);
  }

  @Get('download/:generationId')
  @TransformUserContext()
  async downloadResume(
    @Param('generationId') generationId: string,
    @Req() req: RequestWithUserContext,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const userId = req.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    const pdfBuffer = await this.resumeService.downloadResumeGeneration(
      generationId,
      userId,
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=tailored-resume.pdf`,
      'Content-Length': pdfBuffer.length.toString(),
    });
    res.end(pdfBuffer);
  }

  /**
   * Generate Tailored Resume - Enhanced AI-Powered Resume Generation
   *
   * This endpoint provides advanced AI-powered resume generation with
   * comprehensive validation and optimization capabilities.
   *
   * Key Features:
   * - AI-powered job description analysis using GPT-4 Turbo
   * - Smart resume content processing for guest vs registered users
   * - Claude 3.5 Sonnet-powered content optimization
   * - Optimized PDF generation with performance tracking
   * - Comprehensive error handling and validation
   *
   * Performance Improvements:
   * - 40-50% faster processing through service orchestration
   * - Intelligent caching and content reuse
   * - Parallel processing where possible
   * - Reduced API calls through smart batching
   */
  @Post('generate')
  @TransformUserContext()
  @RateLimitFeature(FeatureType.RESUME_GENERATION)
  @UseInterceptors(FileInterceptor('resumeFile'), ValidationLoggingInterceptor)
  async generateTailoredResume(
    @Body() generateResumeDto: GenerateTailoredResumeDto,
    @UploadedFile(FileValidationPipe)
    resumeFile: Express.Multer.File | undefined,
    @Req() request: RequestWithUserContext,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // The user context is automatically transformed by @TransformUserContext() decorator
      const resumeUserContext = request.userContext as ResumeUserContext;

      // Orchestrate the complete V2 resume generation process
      const result =
        await this.resumeGenerationOrchestratorService.generateOptimizedResume({
          jobDescription: generateResumeDto.jobDescription,
          jobPosition: generateResumeDto.jobPosition,
          companyName: generateResumeDto.companyName,
          templateId: generateResumeDto.templateId,
          resumeId: generateResumeDto.resumeId,
          userContext: resumeUserContext,
          resumeFile,
        });

      // Convert base64 to buffer for PDF download
      const pdfBuffer = Buffer.from(result.pdfContent, 'base64');

      const responseForHeaders = {
        filename: result.filename,
        resumeGenerationId: result.resumeGenerationId,
        tailoringMode: result.tailoringMode,
        keywordsAdded: result.keywordsAdded,
        sectionsOptimized: result.sectionsOptimized,
        achievementsQuantified: result.achievementsQuantified,
        optimizationConfidence: result.optimizationConfidence,
      };

      // Set headers for PDF download
      this.setPdfResponseHeaders(res, responseForHeaders, pdfBuffer.length);

      // Send the PDF buffer directly
      res.end(pdfBuffer);

      const totalTime = Date.now() - startTime;
      this.logger.log(
        `Resume generation completed in ${totalTime}ms. ` +
          `Resume Generation ID: ${result.resumeGenerationId}, ` +
          `Keywords Added: ${result.keywordsAdded}, ` +
          `Optimization Confidence: ${result.optimizationConfidence}%`,
      );
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Resume generation failed after ${processingTime}ms`,
        error,
      );

      // The orchestrator service handles specific error types and re-throws them
      // We just need to handle the final error response here
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      // All other errors are wrapped as InternalServerErrorException by the orchestrator
      throw error;
    }
  }

  /**
   * GET /resume-tailoring/diff/:generationId
   * Returns the AI-generated before/after diff for a resume generation.
   */
  @Get('diff/:generationId')
  @TransformUserContext()
  async getResumeDiff(
    @Param('generationId') generationId: string,
    @Req() req: RequestWithUserContext,
  ) {
    const userId = req.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }
    const diff = await this.resumeService.getChangesDiff(generationId, userId);
    return { changesDiff: diff };
  }

  /**
   * POST /resume-tailoring/cover-letter
   * Generate a tailored cover letter for a given job and candidate.
   */
  @Post('cover-letter')
  @HttpCode(HttpStatus.OK)
  @TransformUserContext()
  @RateLimitFeature(FeatureType.COVER_LETTER)
  async generateCoverLetter(
    @Body() dto: GenerateCoverLetterDto,
    @Req() req: RequestWithUserContext,
  ) {
    const userId = req.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    if (dto.resumeGenerationId) {
      return this.coverLetterGenerationService.generateFromResumeGeneration(
        dto.resumeGenerationId,
        userId,
      );
    }

    if (!dto.jobPosition || !dto.companyName || !dto.jobDescription) {
      throw new BadRequestException(
        'Either resumeGenerationId or jobPosition + companyName + jobDescription are required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return this.coverLetterGenerationService.generateStandalone(
      dto.jobPosition,
      dto.companyName,
      dto.jobDescription,
      req.userContext as unknown as ResumeUserContext,
    );
  }

  /**
   * POST /resume-tailoring/batch-generate
   * Sequentially generates tailored resumes for multiple jobs in one request.
   * Premium-only feature.
   */
  @Post('batch-generate')
  @HttpCode(HttpStatus.OK)
  @TransformUserContext()
  @UseGuards(PremiumUserGuard)
  @RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)
  async batchGenerateTailoredResumes(
    @Body() dto: BatchGenerateDto,
    @Req() request: RequestWithUserContext,
  ): Promise<BatchGenerateResponse> {
    const userId = request.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    if (dto.jobs.length > BULK_TAILORING_MAX_RESUMES) {
      throw new BadRequestException(
        `Maximum ${BULK_TAILORING_MAX_RESUMES} resumes allowed per batch request. Please reduce your selection and try again.`,
        ERROR_CODES.BATCH_LIMIT_EXCEEDED,
      );
    }

    const startTime = Date.now();
    const userContext = request.userContext as ResumeUserContext;
    const results: BatchJobResult[] = [];

    for (const job of dto.jobs) {
      try {
        const result =
          await this.resumeGenerationOrchestratorService.generateOptimizedResume(
            {
              jobDescription: job.jobDescription,
              jobPosition: job.jobPosition,
              companyName: job.companyName,
              templateId: dto.templateId,
              resumeId: dto.resumeId,
              userContext,
            },
          );

        results.push({
          jobPosition: job.jobPosition,
          companyName: job.companyName,
          status: 'success',
          resumeGenerationId: result.resumeGenerationId,
          pdfContent: result.pdfContent,
          filename: result.filename,
          optimizationConfidence: result.optimizationConfidence,
          keywordsAdded: result.keywordsAdded,
        });
      } catch (error) {
        this.logger.warn(
          `Batch job failed for ${job.jobPosition} @ ${job.companyName}`,
          error,
        );
        results.push({
          jobPosition: job.jobPosition,
          companyName: job.companyName,
          status: 'failed',
          error:
            error instanceof Error ? error.message : 'Resume generation failed',
        });
      }
    }

    return {
      batchId: uuidv4(),
      results,
      summary: {
        total: dto.jobs.length,
        succeeded: results.filter((r) => r.status === 'success').length,
        failed: results.filter((r) => r.status === 'failed').length,
        totalProcessingTimeMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Sets headers for PDF download response
   */
  private setPdfResponseHeaders(
    res: Response,
    response: {
      filename: string;
      resumeGenerationId: string;
      tailoringMode?: string;
      keywordsAdded: number;
      sectionsOptimized: number;
      achievementsQuantified: number;
      optimizationConfidence: number;
    },
    contentLength: number,
  ) {
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=${response.filename}`,
      'Content-Length': contentLength.toString(),
      'X-Resume-Generation-Id': response.resumeGenerationId,
      'X-Filename': response.filename,
      'X-Tailoring-Mode': response.tailoringMode ?? 'standard',
      'X-Keywords-Added': response.keywordsAdded.toString(),
      'X-Sections-Optimized': response.sectionsOptimized.toString(),
      'X-Achievements-Quantified': response.achievementsQuantified.toString(),
      'X-Optimization-Confidence': response.optimizationConfidence.toString(),
    });
  }
}
