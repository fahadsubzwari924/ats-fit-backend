import { Processor, Process, OnQueueError, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { Readable } from 'stream';
import { QueueService } from '../../queue/queue.service';
import { QueueMessageStatus } from '../../../shared/enums/queue-message.enum';
import { ResumeGenerationResultService } from '../services/resume-generation-result.service';
import { ResumeGenerationOrchestratorService } from '../services/resume-generation-orchestrator.service';
import {
  ResumeGenerationJobData,
  ResumeGenerationJobStatus,
  RESUME_GENERATION_PROGRESS,
} from '../interfaces/resume-generation-job.interface';
import { ResumeGenerationInput } from '../interfaces/resume-generation.interface';
import type { UserContext as ResumeUserContext } from '../interfaces/user-context.interface';

/**
 * Resume Generation Processor
 *
 * Bull queue processor for async resume generation jobs.
 * Follows Single Responsibility Principle - only handles queue processing.
 *
 * Key Features:
 * - Progress tracking at each major step
 * - Status updates for frontend visibility
 * - Comprehensive error handling
 * - Performance metrics collection
 * - Retry support with exponential backoff
 *
 * Processing Steps:
 * 1. Validation (5%)
 * 2. Job Analysis (15%)
 * 3. Resume Processing (30%)
 * 4. Content Optimization (50%)
 * 5. PDF Generation (70%)
 * 6. ATS Evaluation (85%)
 * 7. Save Results (95%)
 * 8. Complete (100%)
 */
@Processor('resume-generation')
export class ResumeGenerationProcessor {
  private readonly logger = new Logger(ResumeGenerationProcessor.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly resultService: ResumeGenerationResultService,
    private readonly orchestratorService: ResumeGenerationOrchestratorService,
  ) {}

  /**
   * Main job processing handler
   * Orchestrates the complete resume generation pipeline
   */
  @Process('generate-resume')
  async handleResumeGeneration(
    job: Job<ResumeGenerationJobData>,
  ): Promise<void> {
    const { queueMessageId, userId, guestId, resumeFile, ...input } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `Starting resume generation job ${job.id} for queue message ${queueMessageId}`,
    );

    try {
      // Step 1: Update status to processing
      await this.updateJobProgress(
        queueMessageId,
        job,
        ResumeGenerationJobStatus.VALIDATING,
        { step: 'Starting validation' },
      );

      // Convert job data back to Multer file format (only if file was provided)
      let multerFile: Express.Multer.File | undefined = undefined;

      if (resumeFile && resumeFile.buffer) {
        const fileBuffer = Buffer.from(resumeFile.buffer, 'base64');
        multerFile = {
          fieldname: 'resumeFile',
          originalname: resumeFile.originalname,
          encoding: '7bit',
          mimetype: resumeFile.mimetype,
          buffer: fileBuffer,
          size: fileBuffer.length, // Use actual buffer length after decoding
          stream: Readable.from(fileBuffer),
          destination: '',
          filename: resumeFile.originalname,
          path: '',
        };
        this.logger.debug(
          `Converted uploaded file: ${resumeFile.originalname}, size: ${fileBuffer.length} bytes`,
        );
      } else {
        this.logger.debug(
          `No file uploaded, using existing resume with resumeId: ${input.resumeId}`,
        );
      }

      // Build user context for orchestrator
      const userContext: ResumeUserContext = {
        userId,
        guestId,
        userType: userId ? 'freemium' : 'guest', // Simplified for now
      };

      // Build orchestrator input
      // resumeFile can be undefined if user is using existing resume (resumeId)
      const orchestratorInput: ResumeGenerationInput = {
        ...input,
        resumeFile: multerFile,
        userContext,
      };

      /**
       * Execute the complete orchestration pipeline
       *
       * The orchestrator service (generateOptimizedResume) performs all processing internally:
       * - Job analysis using GPT-4 Turbo
       * - Resume content processing (parallel with job analysis)
       * - Content optimization using Claude 3.5 Sonnet
       * - PDF generation with Puppeteer
       * - ATS evaluation
       * - Database persistence
       *
       * Since the orchestrator is a black box that returns the final result,
       * we cannot track granular progress during its execution.
       *
       * The orchestrator takes 96-102 seconds total and handles:
       * - Input validation (~500ms)
       * - Parallel operations: Job analysis + Resume processing (~15-20s)
       * - Content optimization with Claude (~30-40s)
       * - PDF generation (~10-15s)
       * - ATS evaluation (~20-30s)
       * - Database saves (~500ms)
       */

      // Update status to indicate we're starting the main processing
      await this.updateJobProgress(
        queueMessageId,
        job,
        ResumeGenerationJobStatus.PROCESSING_RESUME,
        {
          step: 'Processing resume with AI (this will take ~100 seconds)',
          details:
            'Job analysis, content optimization, PDF generation, and ATS evaluation in progress',
        },
      );

      // Execute the complete orchestration (this is the actual work - takes 96-102 seconds)
      const result =
        await this.orchestratorService.generateOptimizedResume(
          orchestratorInput,
        );

      // Step 7: Save Results
      await this.updateJobProgress(
        queueMessageId,
        job,
        ResumeGenerationJobStatus.SAVING_RESULTS,
        { step: 'Saving results to database' },
      );

      const savingStartTime = Date.now();

      // Save the result to database
      const savedResult = await this.resultService.saveResult(
        queueMessageId,
        userId,
        guestId,
        result,
        result.pdfContent,
      );

      // Update result with company and job details
      await this.resultService.updateResultContext(
        savedResult.id,
        input.companyName,
        input.jobPosition,
      );

      const savingTime = Date.now() - savingStartTime;

      // Step 8: Complete
      const totalProcessingTime = Date.now() - startTime;

      await this.updateJobProgress(
        queueMessageId,
        job,
        ResumeGenerationJobStatus.COMPLETED,
        {
          step: 'Resume generation completed',
          result: {
            resumeGenerationId: result.resumeGenerationId,
            atsScore: result.atsScore,
            atsConfidence: result.atsConfidence,
            filename: result.filename,
            fileSize: result.pdfSizeBytes,
            resultId: savedResult.id,
            keywordsAdded: result.keywordsAdded,
            sectionsOptimized: result.sectionsOptimized,
            optimizationConfidence: result.optimizationConfidence,
          },
          processingMetrics: {
            ...result.processingMetrics,
            savingTimeMs: savingTime,
            totalProcessingTimeMs: totalProcessingTime,
          },
        },
      );

      this.logger.log(
        `Resume generation job ${job.id} completed successfully in ${totalProcessingTime}ms. ` +
          `ATS Score: ${result.atsScore}%, Keywords Added: ${result.keywordsAdded}`,
      );
    } catch (error) {
      await this.handleJobError(queueMessageId, job, error, startTime);
    }
  }

  /**
   * Update job progress and status
   * Updates both Bull job progress and queue message status
   */
  private async updateJobProgress(
    queueMessageId: string,
    job: Job<ResumeGenerationJobData>,
    status: ResumeGenerationJobStatus,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      const progress = RESUME_GENERATION_PROGRESS[status];

      // Update Bull job progress for monitoring
      await job.progress(progress);

      // Map our custom status to queue message status
      const queueStatus = this.mapToQueueStatus(status);

      // Update queue message with status and metadata
      await this.queueService.updateQueueMessageStatus(
        queueMessageId,
        queueStatus,
        {
          result: metadata,
        },
      );

      this.logger.debug(
        `Updated job ${job.id} progress: ${progress}% - ${status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update job progress for ${queueMessageId}`,
        error,
      );
      // Don't throw - progress update failure shouldn't stop processing
    }
  }

  /**
   * Map resume generation status to queue message status
   */
  private mapToQueueStatus(
    status: ResumeGenerationJobStatus,
  ): QueueMessageStatus {
    switch (status) {
      case ResumeGenerationJobStatus.QUEUED:
        return QueueMessageStatus.QUEUED;
      case ResumeGenerationJobStatus.COMPLETED:
        return QueueMessageStatus.COMPLETED;
      case ResumeGenerationJobStatus.FAILED:
        return QueueMessageStatus.FAILED;
      case ResumeGenerationJobStatus.RETRYING:
        return QueueMessageStatus.RETRYING;
      default:
        return QueueMessageStatus.PROCESSING;
    }
  }

  /**
   * Handle job processing errors
   */
  private async handleJobError(
    queueMessageId: string,
    job: Job<ResumeGenerationJobData>,
    error: unknown,
    startTime: number,
  ): Promise<void> {
    const processingTime = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    this.logger.error(
      `Resume generation job ${job.id} failed after ${processingTime}ms: ${errorMessage}`,
      error instanceof Error ? error.stack : undefined,
    );

    // Update queue message with failure status
    await this.queueService.updateQueueMessageStatus(
      queueMessageId,
      QueueMessageStatus.FAILED,
      {
        errorDetails: errorMessage,
        processingDurationMs: processingTime,
      },
    );

    // Re-throw to let Bull handle retry logic
    throw error;
  }

  /**
   * Global error handler for queue
   */
  @OnQueueError()
  onQueueError(error: Error): void {
    this.logger.error('Queue error occurred:', error);
  }

  /**
   * Handler for failed jobs
   */
  @OnQueueFailed()
  async onQueueFailed(
    job: Job<ResumeGenerationJobData>,
    error: Error,
  ): Promise<void> {
    this.logger.error(
      `Job ${job.id} failed permanently after ${job.attemptsMade} attempts`,
      error,
    );

    // Ensure queue message is marked as failed
    await this.queueService.updateQueueMessageStatus(
      job.data.queueMessageId,
      QueueMessageStatus.FAILED,
      {
        errorDetails: error.message,
      },
    );
  }
}
