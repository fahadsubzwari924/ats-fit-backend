import { Process, Processor } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractedResumeContent } from '../../database/entities/extracted-resume-content.entity';
import { QueueMessage } from '../../database/entities/queue-message.entity';
import { ResumeService } from '../resume-tailoring/services/resume.service';
import * as crypto from 'crypto';

export interface ResumeProcessingJobData {
  queueMessageId: string;
  userId: string;
  fileName: string;
  fileBuffer: Buffer;
  fileSize: number;
  resumeId: string;
}

@Processor('resume_processing')
export class ResumeProcessingProcessor implements OnModuleInit {
  private readonly logger = new Logger(ResumeProcessingProcessor.name);

  constructor(
    @InjectRepository(ExtractedResumeContent)
    private readonly extractedResumeRepository: Repository<ExtractedResumeContent>,
    @InjectRepository(QueueMessage)
    private readonly queueMessageRepository: Repository<QueueMessage>,
    private readonly resumeService: ResumeService,
  ) {
    this.logger.log('ResumeProcessingProcessor constructor called');
  }

  onModuleInit() {
    this.logger.log(
      'ResumeProcessingProcessor initialized and ready to process jobs',
    );
  }

  @Process('extract_resume_content')
  async handleResumeExtraction(
    job: Job<ResumeProcessingJobData>,
  ): Promise<void> {
    this.logger.log(`🔥 PROCESSOR METHOD CALLED! Job ID: ${job.id}`, {
      jobData: job.data,
    });

    const { queueMessageId, userId, fileName, fileBuffer, fileSize, resumeId } =
      job.data;
    const startTime = Date.now();

    this.logger.log(
      `Starting resume extraction for user ${userId}, file: ${fileName}`,
      {
        queueMessageId,
        resumeId,
        jobId: job.id,
      },
    );

    try {
      // Update queue message status to processing
      await this.updateQueueMessageStatus(queueMessageId, 'processing');

      // Update job progress
      await job.progress(10);

      // Create a temporary file object for processing
      const tempFile: Express.Multer.File = {
        fieldname: 'resumeFile',
        originalname: fileName,
        encoding: '7bit',
        mimetype: 'application/pdf',
        buffer: fileBuffer,
        size: fileSize,
        stream: null,
        destination: '',
        filename: '',
        path: '',
      };

      await job.progress(20);

      // Extract text from resume using existing service
      this.logger.log(`Extracting text from resume: ${fileName}`, {
        queueMessageId,
      });
      const extractedText =
        await this.resumeService.extractTextFromResume(tempFile);

      await job.progress(50);

      // Generate structured content using dedicated extraction service
      this.logger.log(`Generating structured content for: ${fileName}`, {
        queueMessageId,
      });

      const structuredContent =
        await this.resumeService.extractStructuredContentFromResume(
          extractedText,
        );

      await job.progress(80);

      // Calculate processing duration
      const processingDuration = Date.now() - startTime;

      // Update the business entity with extracted content
      await this.extractedResumeRepository.update(
        { id: resumeId },
        {
          extractedText,
          structuredContent,
        },
      );

      // Update queue message status to completed
      await this.updateQueueMessageStatus(queueMessageId, 'completed', {
        processingDurationMs: processingDuration,
        result: {
          success: true,
          resumeId,
          extractedContentSize: extractedText.length,
          hasStructuredContent: Object.keys(structuredContent).length > 0,
        },
      });

      await job.progress(100);

      this.logger.log(
        `Successfully processed resume ${fileName} for user ${userId} in ${processingDuration}ms`,
        {
          queueMessageId,
          resumeId,
          processingDurationMs: processingDuration,
        },
      );
    } catch (error) {
      const processingDuration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Failed to process resume ${fileName} for user ${userId}: ${errorMessage}`,
        {
          queueMessageId,
          resumeId,
          processingDurationMs: processingDuration,
          error: error instanceof Error ? error.stack : undefined,
        },
      );

      // Update queue message status to failed
      await this.updateQueueMessageStatus(queueMessageId, 'failed', {
        errorDetails: errorMessage,
        processingDurationMs: processingDuration,
      });

      throw error;
    }
  }

  /**
   * Update queue message status with proper audit trail
   */
  private async updateQueueMessageStatus(
    queueMessageId: string,
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'retrying',
    additionalData?: {
      result?: Record<string, any>;
      errorDetails?: string;
      processingDurationMs?: number;
    },
  ): Promise<void> {
    const updateData: Partial<QueueMessage> = {
      status,
    };

    if (status === 'processing') {
      updateData.startedAt = new Date();
    }

    if (status === 'completed' || status === 'failed') {
      updateData.completedAt = new Date();
      if (additionalData?.processingDurationMs) {
        updateData.processingDurationMs = additionalData.processingDurationMs;
      }
    }

    if (additionalData?.result) {
      updateData.result = additionalData.result;
    }

    if (additionalData?.errorDetails) {
      updateData.errorDetails = additionalData.errorDetails;
    }

    // Update the queue message
    await this.queueMessageRepository
      .createQueryBuilder()
      .update(QueueMessage)
      .set(updateData)
      .where('id = :id', { id: queueMessageId })
      .execute();

    // Increment attempts separately
    await this.queueMessageRepository
      .createQueryBuilder()
      .update(QueueMessage)
      .set({ attempts: () => 'attempts + 1' })
      .where('id = :id', { id: queueMessageId })
      .execute();

    this.logger.log(
      `Updated queue message ${queueMessageId} status to ${status}`,
    );
  }

  /**
   * Generate file hash for deduplication
   */
  static generateFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}
