import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { QueueMessage } from '../../../database/entities/queue-message.entity';
import { QueueMessagePriority } from '../../../shared/enums/queue-message.enum';
import { ResumeExtractionJobData } from '../processors/resume-extraction.processor';
import {
  ResumeGenerationJobData,
  ResumeFileData,
} from '../interfaces/resume-generation-job.interface';
import { FileUtil } from '../../../shared/utils/file.util';
import { ResumeContentService } from './resume-content.service';
import { QueueService } from '../../queue/queue.service';

/**
 * Resume Queue Service
 *
 * Domain-specific service for resume queue operations.
 * Handles resume extraction job creation with business logic.
 *
 * Follows Domain-Driven Design:
 * - Domain logic stays in domain module
 * - Uses infrastructure (QueueService) for queue tracking
 * - Encapsulates resume-specific queue operations
 */
@Injectable()
export class ResumeQueueService {
  private readonly logger = new Logger(ResumeQueueService.name);

  constructor(
    @InjectQueue('resume_processing')
    private readonly resumeProcessingQueue: Queue<ResumeExtractionJobData>,
    @InjectQueue('resume-generation')
    private readonly resumeGenerationQueue: Queue<ResumeGenerationJobData>,
    @InjectRepository(QueueMessage)
    private readonly queueMessageRepository: Repository<QueueMessage>,
    private readonly resumeContentService: ResumeContentService,
    private readonly queueService: QueueService,
  ) {}

  /**
   * Add resume processing job with proper queue tracking
   * Uses ResumeContentService for business logic separation
   */
  async addResumeProcessingJob(
    userId: string,
    fileName: string,
    fileBuffer: Buffer,
  ): Promise<ExtractedResumeContent> {
    const fileSize = fileBuffer.length;
    const fileHash = FileUtil.generateFileHash(fileBuffer);

    // Check if this file has already been processed using ResumeContentService
    const existingContent =
      await this.resumeContentService.findExistingByFileHash(userId, fileHash);

    if (existingContent) {
      this.logger.log(
        `Resume with hash ${fileHash} already exists for user ${userId}`,
      );
      return existingContent;
    }

    // Create queue message for tracking
    const queueMessage = await this.queueService.createQueueJob({
      queueName: 'resume_processing',
      jobType: 'extract_resume_content',
      userId,
      entityName: 'extracted_resume_content',
      payload: {
        fileName,
        fileSize,
        fileHash,
        fileBuffer: FileUtil.bufferToBase64(fileBuffer), // Store as base64 for JSON compatibility
      },
      priority: QueueMessagePriority.NORMAL,
      metadata: {
        originalFileName: fileName,
        fileSize,
        fileHash,
      },
    });

    // Create business entity using ResumeContentService
    const savedRecord =
      await this.resumeContentService.createExtractedResumeRecord({
        userId,
        queueMessageId: queueMessage.id,
        originalFileName: fileName,
        fileSize,
        fileHash,
      });

    // Update queue message with entity ID
    await this.queueMessageRepository.update(queueMessage.id, {
      entityId: savedRecord.id,
    });

    // Add job to Bull queue with queue message ID
    const job = await this.resumeProcessingQueue.add(
      'extract_resume_content',
      {
        queueMessageId: queueMessage.id,
        userId,
        fileName,
        fileBuffer, // Keep as Buffer for processing
        fileSize,
        resumeId: savedRecord.id,
      },
      {
        priority: 1,
        delay: 0,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    );

    this.logger.log(
      `Added resume processing job ${job.id} for user ${userId}, file: ${fileName}`,
      {
        queueMessageId: queueMessage.id,
        resumeId: savedRecord.id,
        correlationId: queueMessage.correlationId,
        jobStatus: await job.getState(),
        jobProgress: (await job.progress()) as number | object,
      },
    );

    return savedRecord;
  }

  /**
   * Add resume generation job to queue (async processing)
   * Creates queue message, adds to Bull queue, and returns tracking info
   *
   * Domain-specific method for resume generation queue operations
   */
  async addResumeGenerationJob(input: {
    userId?: string;
    guestId?: string;
    jobDescription: string;
    jobPosition: string;
    companyName: string;
    templateId: string;
    resumeId?: string;
    resumeFile?: ResumeFileData;
  }): Promise<QueueMessage> {
    const {
      userId,
      guestId,
      jobDescription,
      jobPosition,
      companyName,
      templateId,
      resumeId,
      resumeFile,
    } = input;

    // Create queue message for tracking
    const queueMessage = await this.queueService.createQueueJob({
      queueName: 'resume-generation',
      jobType: 'generate-resume',
      userId,
      entityName: 'resume_generation_result',
      payload: {
        jobDescription,
        jobPosition,
        companyName,
        templateId,
        resumeId,
        hasResumeFile: !!resumeFile,
      },
      priority: QueueMessagePriority.NORMAL,
      metadata: {
        userType: userId ? 'registered' : 'guest',
        guestId,
        estimatedDuration: '100000ms', // 100 seconds estimated
        jobPosition,
        companyName,
      },
    });

    // Add to Bull queue for processing
    const job = await this.resumeGenerationQueue.add(
      'generate-resume',
      {
        queueMessageId: queueMessage.id,
        userId,
        guestId,
        jobDescription,
        jobPosition,
        companyName,
        templateId,
        resumeId,
        resumeFile,
      },
      {
        priority: 1, // High priority for user-facing jobs
        attempts: 3, // Retry up to 3 times
        backoff: {
          type: 'exponential',
          delay: 5000, // Start with 5 second delay
        },
        removeOnComplete: false, // Keep completed jobs for history
        removeOnFail: false, // Keep failed jobs for debugging
      },
    );

    this.logger.log(
      `Added resume generation job ${job.id} for queue message ${queueMessage.id}. ` +
        `User: ${userId || guestId}, Position: ${jobPosition} at ${companyName}`,
    );

    return queueMessage;
  }

  /**
   * Get resume generation job status by queue message ID
   * Returns comprehensive status including progress and result
   */
  async getResumeGenerationStatus(
    queueMessageId: string,
  ): Promise<QueueMessage | null> {
    return this.queueService.getQueueMessage(queueMessageId);
  }
}
