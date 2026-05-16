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
import { CoverLetterPdfService } from './services/cover-letter-pdf.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { GenerateTailoredResumeDto } from './dtos/generate-tailored-resume.dto';
import { CheckJobRelevanceDto } from './dtos/check-job-relevance.dto';
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
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { UsageTrackingInterceptor } from '../rate-limit/usage-tracking.interceptor';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { ForbiddenException } from '@nestjs/common';
import { PremiumUserGuard } from '../auth/guards/premium-user.guard';
import { UserPlan } from '../../database/entities/user.entity';
import { Public } from '../auth/decorators/public.decorator';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { TransformUserContext } from '../../shared/decorators/transform-user-context.decorator';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  BULK_TAILORING_MAX_RESUMES,
  HISTORY_DEFAULT_LIMIT,
  HISTORY_DEFAULT_PAGE,
} from '../../shared/constants/resume-tailoring.constants';
import { TailoredResumeResponseMapper } from './mappers/tailored-resume-response.mapper';
import { JOB_RELEVANCE_CONSTANTS } from '../job-relevance/constants/job-relevance.constants';
import { JobRelevanceEngine } from '../job-relevance/enums/job-relevance-engine.enum';
import { AsciiSafeJsonUtil } from '../../shared/utils/ascii-safe-json.util';

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
    private readonly coverLetterPdfService: CoverLetterPdfService,
    private readonly rateLimitService: RateLimitService,
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
        page: parseInt(page, 10) || HISTORY_DEFAULT_PAGE,
        limit:
          parseInt(limit ?? String(HISTORY_DEFAULT_LIMIT), 10) ||
          HISTORY_DEFAULT_LIMIT,
        search,
        sortOrder: sortOrder ?? 'DESC',
        plan,
      });
    }

    return this.resumeService.getResumeGenerationHistory(
      userId,
      parseInt(limit ?? String(HISTORY_DEFAULT_LIMIT), 10) ||
        HISTORY_DEFAULT_LIMIT,
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

    const { buffer: pdfBuffer, filename } =
      await this.resumeService.downloadResumeGeneration(generationId, userId);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length.toString(),
      'X-Filename': filename,
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
  @UseInterceptors(
    FileInterceptor('resumeFile'),
    ValidationLoggingInterceptor,
    UsageTrackingInterceptor,
  )
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
          acknowledgeLowFit: generateResumeDto.acknowledgeLowFit ?? false,
        });

      if (result.kind === 'low_fit_warning') {
        res.setHeader(
          JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_SCORE,
          String(result.relevance.score),
        );
        res.setHeader(
          JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_VERDICT,
          result.relevance.verdict,
        );
        res.setHeader('Content-Type', 'application/json');
        res.status(200).json({
          type: JOB_RELEVANCE_CONSTANTS.RESPONSE_TYPES.LOW_FIT_WARNING,
          relevance: result.relevance,
        });
        return;
      }

      // PDF path — add relevance headers
      res.setHeader(
        JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_SCORE,
        String(result.relevance?.score ?? ''),
      );
      res.setHeader(
        JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_VERDICT,
        result.relevance?.verdict ?? '',
      );
      res.setHeader(
        JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_CACHE_HIT,
        String(result.relevance?.engine === JobRelevanceEngine.CACHE_HIT),
      );
      // Full breakdown JSON for the frontend Fit Score step. ASCII-safe encode
      // because gaps/strengths may contain non-ASCII characters that Node
      // rejects in HTTP headers with ERR_INVALID_CHAR.
      if (result.relevance) {
        res.setHeader(
          JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_BLOCK,
          AsciiSafeJsonUtil.stringify(result.relevance),
        );
      }

      // Convert base64 to buffer for PDF download
      const pdfBuffer = Buffer.from(result.pdfContent, 'base64');

      TailoredResumeResponseMapper.applyHeaders(res, result, pdfBuffer.length);

      // Send the PDF buffer directly
      res.end(pdfBuffer);

      const totalTime = Date.now() - startTime;
      this.logger.log(
        `Resume generation completed in ${totalTime}ms. ` +
          `Resume Generation ID: ${result.resumeGenerationId}, ` +
          `Keywords Added: ${result.keywordsAdded}`,
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
   * POST /resume-tailoring/relevance
   *
   * Lightweight relevance pre-check used by the multi-step tailor flow. Runs
   * ONLY the job-fit scoring pass — no tailoring, no PDF, no quota consumed,
   * no DB write. Returns the canonical `JobRelevanceResult` so the client can
   * show the breakdown before the user commits to spending a generation
   * credit on the full tailor.
   *
   * The Redis cache stores the scored result under
   * `relevance:v2:{profileVersion}:{jdHash}` — so when the client subsequently
   * calls `/generate`, the orchestrator's relevance step is a free cache hit.
   */
  @Post('relevance')
  @HttpCode(HttpStatus.OK)
  @TransformUserContext()
  @UseInterceptors(FileInterceptor('resumeFile'), ValidationLoggingInterceptor)
  async checkJobRelevance(
    @Body() dto: CheckJobRelevanceDto,
    @UploadedFile(FileValidationPipe)
    resumeFile: Express.Multer.File | undefined,
    @Req() request: RequestWithUserContext,
  ): Promise<{ relevance: unknown }> {
    const resumeUserContext = request.userContext as ResumeUserContext;
    const relevance =
      await this.resumeGenerationOrchestratorService.checkRelevanceOnly({
        jobDescription: dto.jobDescription,
        jobPosition: dto.jobPosition,
        companyName: dto.companyName,
        // templateId is not needed for relevance scoring; pass an empty string
        // since the input interface requires it. The orchestrator's
        // checkRelevanceOnly path never reads this field.
        templateId: '',
        resumeId: dto.resumeId,
        userContext: resumeUserContext,
        resumeFile,
        acknowledgeLowFit: false,
      });
    return { relevance };
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
  @UseInterceptors(UsageTrackingInterceptor)
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
   * GET /resume-tailoring/cover-letter/:generationId
   * Fetch a previously persisted cover letter for a resume generation.
   * Does not consume cover letter quota.
   */
  @Get('cover-letter/:generationId')
  @TransformUserContext()
  async getCoverLetter(
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
    return this.coverLetterGenerationService.getByResumeGenerationId(
      generationId,
      userId,
    );
  }

  /**
   * GET /resume-tailoring/cover-letter/:generationId/download
   * Stream the persisted cover letter as a PDF. The structured cover-letter
   * JSON was generated and saved at the time the resume was tailored (or
   * later, via the POST endpoint above). This endpoint is download-only —
   * it does not generate content and does not consume cover-letter quota.
   * Mirrors the resume download endpoint's contract (Content-Type + X-Filename).
   */
  @Get('cover-letter/:generationId/download')
  @TransformUserContext()
  async downloadCoverLetterPdf(
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

    const coverLetter =
      await this.coverLetterGenerationService.getByResumeGenerationId(
        generationId,
        userId,
      );

    const generationRecord = await this.resumeService.getResumeGenerationDetail(
      generationId,
      userId,
    );

    const { buffer, filename } = await this.coverLetterPdfService.renderPdf({
      coverLetter,
      jobPosition: generationRecord?.jobPosition ?? null,
      companyName: generationRecord?.companyName ?? null,
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': buffer.length.toString(),
      'X-Filename': filename,
    });
    res.end(buffer);
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
  @UseInterceptors(UsageTrackingInterceptor)
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

    // Shared-pool pre-check: every resume produced (single or batch) draws from
    // the same monthly RESUME_GENERATION pool. Reject before enqueueing if this
    // batch would push the user over their tailored-resume limit.
    const authUserContext = request.userContext;
    const tailoredResumeUsage = await this.rateLimitService.checkRateLimit(
      authUserContext,
      FeatureType.RESUME_GENERATION,
    );
    if (
      tailoredResumeUsage.currentUsage + dto.jobs.length >
      tailoredResumeUsage.limit
    ) {
      throw new ForbiddenException({
        message: `This batch would exceed your monthly tailored-resume limit. ${tailoredResumeUsage.remaining} of ${tailoredResumeUsage.limit} remaining; you requested ${dto.jobs.length}.`,
        errorCode: ERROR_CODES.RATE_LIMIT_EXCEEDED,
        feature: FeatureType.RESUME_GENERATION,
        currentUsage: tailoredResumeUsage.currentUsage,
        limit: tailoredResumeUsage.limit,
        remaining: tailoredResumeUsage.remaining,
        resetDate: tailoredResumeUsage.resetDate,
      });
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

        if (result.kind !== 'pdf') {
          this.logger.warn(
            `[batch-v1] job returned non-pdf result kind=${result.kind} — skipping (enable JOB_RELEVANCE_GATE_ENABLED to handle low-fit in v2 batch)`,
          );
          continue;
        }

        // Each resume successfully produced inside the batch consumes 1 unit of
        // the shared RESUME_GENERATION pool. Failed jobs do NOT consume quota.
        await this.rateLimitService.recordUsage(
          authUserContext,
          FeatureType.RESUME_GENERATION,
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
          sectionsChanged: result.sectionsChanged,
          // Canonical MatchScoreBlock — single source of truth on every API.
          matchScore: result.matchScore,
          // TODO: remove after FE migration lands
          matchScoreBefore: result.matchScoreBefore,
          matchScoreAfter: result.matchScoreAfter,
        });
      } catch (error) {
        this.logger.warn(
          `Batch job failed for ${job.jobPosition} @ ${job.companyName}`,
          error,
        );
        // Inline-synthesize the v2 envelope shape so the v1 API contract
        // matches the v2 one. We don't pull in BatchJobErrorClassifierService
        // here to avoid widening the v1 module's dep graph for a legacy
        // endpoint; the envelope keeps `category: 'UNKNOWN'` + retryable.
        const rawMessage =
          error instanceof Error ? error.message : 'Resume generation failed';
        results.push({
          jobPosition: job.jobPosition,
          companyName: job.companyName,
          status: 'failed',
          error: {
            category: 'UNKNOWN',
            userMessage: rawMessage,
            technicalDetail: 'legacy-v1-batch',
            retryable: true,
            occurredAt: new Date().toISOString(),
          },
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
}
