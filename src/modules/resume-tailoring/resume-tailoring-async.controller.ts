import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Logger,
  Req,
  Res,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { GenerateTailoredResumeDto } from './dtos/generate-tailored-resume.dto';
import { FileValidationPipe } from '../../shared/pipes/file-validation.pipe';
import { ValidationLoggingInterceptor } from './interceptors/validation-logging.interceptor';
import {
  NotFoundException,
  BadRequestException,
} from '../../shared/exceptions/custom-http-exceptions';
import { RateLimitFeature } from '../rate-limit/rate-limit.guard';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { Public } from '../auth/decorators/public.decorator';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';
import { TransformUserContext } from '../../shared/decorators/transform-user-context.decorator';
import { Response } from 'express';
import type { UserContext as ResumeUserContext } from './interfaces/user-context.interface';
import { ResumeQueueService } from './services/resume-queue.service';
import { QueueMessageStatus } from '../../shared/enums/queue-message.enum';
import { ResumeGenerationResultService } from './services/resume-generation-result.service';
import { ResumeFileData } from './interfaces/resume-generation-job.interface';

/**
 * Resume Tailoring Async Controller
 *
 * Handles async resume generation with queue-based processing.
 * Provides immediate response with job tracking and progress updates.
 *
 * Key Endpoints:
 * - POST /generate-async: Start async generation (returns job ID in ~500ms)
 * - GET /status/:jobId: Check job progress and status
 * - GET /download/:jobId: Download completed PDF
 *
 * Benefits over sync version:
 * - 99.5% faster perceived response time
 * - No timeout issues
 * - Progress visibility for users
 * - Better resource utilization
 */
@ApiTags('Resume Tailoring - Async')
@Controller('resume-tailoring/async')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ResumeTailoringAsyncController {
  private readonly logger = new Logger(ResumeTailoringAsyncController.name);

  constructor(
    private readonly resumeQueueService: ResumeQueueService,
    private readonly resumeGenerationResultService: ResumeGenerationResultService,
  ) {}

  /**
   * Generate Tailored Resume - ASYNC VERSION
   *
   * Starts async resume generation and returns immediately with job ID.
   * Use this for better UX with long-running AI operations.
   *
   * Response Time: ~500ms (99.5% faster than sync)
   * Processing Time: ~100s (background)
   *
   * Flow:
   * 1. POST /generate-async → Get job ID (500ms)
   * 2. Poll GET /status/:jobId → Check progress (every 2-5s)
   * 3. GET /download/:jobId → Download PDF when complete
   */
  @Post('generate')
  @Public()
  @TransformUserContext()
  @RateLimitFeature(FeatureType.RESUME_GENERATION)
  @UseInterceptors(FileInterceptor('resumeFile'), ValidationLoggingInterceptor)
  @ApiOperation({ summary: 'Generate tailored resume asynchronously' })
  @ApiResponse({
    status: 200,
    description: 'Job created successfully. Use jobId to track progress.',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async generateTailoredResumeAsync(
    @Body() generateResumeDto: GenerateTailoredResumeDto,
    @UploadedFile(FileValidationPipe)
    resumeFile: Express.Multer.File | undefined,
    @Req() request: RequestWithUserContext,
  ): Promise<{
    jobId: string;
    status: string;
    message: string;
    estimatedCompletionTime: number;
    pollingInterval: number;
    statusUrl: string;
  }> {
    const startTime = Date.now();
    const resumeUserContext = request.userContext as ResumeUserContext;

    try {
      // Convert resume file to queue-compatible format
      const resumeFileData: ResumeFileData | undefined = resumeFile
        ? {
            originalname: resumeFile.originalname,
            buffer: resumeFile.buffer.toString('base64'),
            size: resumeFile.size,
            mimetype: resumeFile.mimetype,
          }
        : undefined;

      // Create queue job (non-blocking)
      // Add job to queue for async processing
      const queueMessage = await this.resumeQueueService.addResumeGenerationJob(
        {
          userId: resumeUserContext.userId,
          guestId: resumeUserContext.guestId,
          jobDescription: generateResumeDto.jobDescription,
          jobPosition: generateResumeDto.jobPosition,
          companyName: generateResumeDto.companyName,
          templateId: generateResumeDto.templateId,
          resumeId: generateResumeDto.resumeId,
          resumeFile: resumeFileData,
        },
      );

      const responseTime = Date.now() - startTime;

      this.logger.log(
        `Async resume generation started in ${responseTime}ms. ` +
          `Job ID: ${queueMessage.id}, User: ${resumeUserContext.userId || resumeUserContext.guestId}`,
      );

      return {
        jobId: queueMessage.id,
        status: QueueMessageStatus.QUEUED,
        message:
          'Resume generation started. Poll the status endpoint to track progress and download when ready.',
        estimatedCompletionTime: 100, // seconds
        pollingInterval: 2000, // Recommended polling interval in ms
        statusUrl: `/api/v1/resume-tailoring/async/status/${queueMessage.id}`,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to start async resume generation after ${processingTime}ms`,
        error,
      );

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw error;
    }
  }

  /**
   * Get Resume Generation Status
   *
   * Poll this endpoint to check job progress.
   * Returns current status, progress %, and result when complete.
   *
   * Status Flow:
   * queued (0%) → validating (5%) → analyzing_job (15%) →
   * processing_resume (30%) → optimizing_content (50%) →
   * generating_pdf (70%) → evaluating_ats (85%) →
   * saving_results (95%) → completed (100%)
   */
  @Get('status/:jobId')
  @Public()
  @TransformUserContext()
  @ApiOperation({ summary: 'Get resume generation job status' })
  @ApiResponse({
    status: 200,
    description: 'Job status retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getResumeGenerationStatus(
    @Param('jobId') jobId: string,
    @Req() request: RequestWithUserContext,
  ): Promise<{
    jobId: string;
    status: string;
    progress: number;
    currentStep: string;
    result?: Record<string, any>;
    error?: string;
    processingMetrics?: Record<string, any>;
    createdAt: Date;
    startedAt?: Date;
    completedAt?: Date;
    estimatedTimeRemaining?: number;
  }> {
    const resumeUserContext = request.userContext as ResumeUserContext;

    // Get queue message
    const queueMessage =
      await this.resumeQueueService.getResumeGenerationStatus(jobId);

    if (!queueMessage) {
      throw new NotFoundException('Job not found');
    }

    // Verify user owns this job (security check)
    const isOwner =
      (resumeUserContext.userId &&
        queueMessage.userId === resumeUserContext.userId) ||
      (resumeUserContext.guestId &&
        queueMessage.metadata?.guestId === resumeUserContext.guestId);

    if (!isOwner) {
      throw new NotFoundException('Job not found'); // Don't reveal existence
    }

    // Map status to user-friendly response
    const statusMapping: Record<string, { progress: number; step: string }> = {
      queued: { progress: 0, step: 'Job queued, waiting to start' },
      processing: { progress: 50, step: 'Processing in progress' },
      completed: { progress: 100, step: 'Resume generation completed' },
      failed: { progress: 0, step: 'Processing failed' },
      retrying: { progress: 0, step: 'Retrying after error' },
    };

    const statusInfo = statusMapping[queueMessage.status] || {
      progress: 0,
      step: 'Unknown status',
    };

    // If processing, try to get more detailed progress from result metadata
    const progress = statusInfo.progress;
    let currentStep = statusInfo.step;

    if (queueMessage.result?.step) {
      currentStep = queueMessage.result.step as string;
    }

    // Calculate estimated time remaining
    let estimatedTimeRemaining: number | undefined;
    if (
      queueMessage.status !== QueueMessageStatus.COMPLETED &&
      queueMessage.status !== QueueMessageStatus.FAILED
    ) {
      const elapsedTime =
        Date.now() - new Date(queueMessage.queuedAt).getTime();
      const estimatedTotal = 100000; // 100 seconds
      estimatedTimeRemaining = Math.max(
        0,
        Math.floor((estimatedTotal - elapsedTime) / 1000),
      );
    }

    return {
      jobId: queueMessage.id,
      status: queueMessage.status,
      progress,
      currentStep,
      result: queueMessage.result,
      error: queueMessage.errorDetails || undefined,
      processingMetrics: queueMessage.metadata,
      createdAt: queueMessage.queuedAt,
      startedAt: queueMessage.startedAt || undefined,
      completedAt: queueMessage.completedAt || undefined,
      estimatedTimeRemaining,
    };
  }

  /**
   * Download Generated Resume PDF
   *
   * Call when status = 'completed' to download PDF.
   * PDFs are stored for 7 days, then auto-deleted.
   */
  @Get('download/:jobId')
  @Public()
  @TransformUserContext()
  @ApiOperation({ summary: 'Download generated resume PDF' })
  @ApiResponse({ status: 200, description: 'PDF downloaded successfully' })
  @ApiResponse({ status: 404, description: 'Job or PDF not found' })
  @ApiResponse({ status: 400, description: 'Job not completed yet' })
  async downloadGeneratedResume(
    @Param('jobId') jobId: string,
    @Req() request: RequestWithUserContext,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    const resumeUserContext = request.userContext as ResumeUserContext;

    // Get queue message
    const queueMessage =
      await this.resumeQueueService.getResumeGenerationStatus(jobId);

    if (!queueMessage) {
      throw new NotFoundException('Job not found');
    }

    // Verify user owns this job
    const isOwner =
      (resumeUserContext.userId &&
        queueMessage.userId === resumeUserContext.userId) ||
      (resumeUserContext.guestId &&
        queueMessage.metadata?.guestId === resumeUserContext.guestId);

    if (!isOwner) {
      throw new NotFoundException('Job not found');
    }

    // Check if job is completed
    if (queueMessage.status !== QueueMessageStatus.COMPLETED) {
      throw new BadRequestException(
        `Resume not ready. Current status: ${queueMessage.status}. Please check status endpoint for updates.`,
      );
    }

    // Get result from result service
    const result =
      await this.resumeGenerationResultService.getResultByQueueMessageId(jobId);

    if (!result) {
      throw new NotFoundException(
        'Resume generation result not found. It may have expired (7 day retention).',
      );
    }

    // Get PDF content
    const pdfBuffer = await this.resumeGenerationResultService.getPdfContent(
      result.id,
    );

    // Set response headers
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=${result.filename}`,
      'Content-Length': pdfBuffer.length.toString(),
      'X-Resume-Generation-Id': result.resumeGenerationId,
      'X-ATS-Score': result.atsScore.toString(),
      'X-Filename': result.filename,
      'X-Job-Id': jobId,
    });

    res.end(pdfBuffer);

    this.logger.log(
      `Resume downloaded for job ${jobId}. ATS Score: ${result.atsScore}%, File: ${result.filename}`,
    );
  }
}
