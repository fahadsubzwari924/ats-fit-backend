import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { QueueMessage } from '../../../database/entities/queue-message.entity';
import { QueueMessagePriority } from '../../../shared/enums/queue-message.enum';
import {
  ResumeExtractionJobData,
  ProfileEnrichmentJobData,
  ChangesDiffJobData,
} from '../interfaces/resume-extraction.interface';
import { FileUtil } from '../../../shared/utils/file.util';
import { ResumeContentService } from './resume-content.service';
import { v4 as uuidv4 } from 'uuid';
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
    @InjectQueue('profile_enrichment')
    private readonly profileEnrichmentQueue: Queue<ProfileEnrichmentJobData>,
    @InjectQueue('changes_diff')
    private readonly changesDiffQueue: Queue<ChangesDiffJobData>,
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
    s3Url: string,
  ): Promise<ExtractedResumeContent> {
    const fileHash = FileUtil.generateFileHash(Buffer.from(fileName + s3Url));
    const preGeneratedId = uuidv4();

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
      entityId: preGeneratedId,
      payload: {
        fileName,
        fileHash,
        s3Url,
      },
      priority: QueueMessagePriority.NORMAL,
      metadata: {
        originalFileName: fileName,
        fileHash,
      },
    });

    // Create business entity using ResumeContentService
    const savedRecord =
      await this.resumeContentService.createExtractedResumeRecord({
        id: preGeneratedId,
        userId,
        queueMessageId: queueMessage.id,
        originalFileName: fileName,
        fileSize: 0,
        fileHash,
      });

    // Add job to Bull queue with queue message ID
    const job = await this.resumeProcessingQueue.add(
      'extract_resume_content',
      {
        queueMessageId: queueMessage.id,
        userId,
        fileName,
        s3Url,
        fileSize: savedRecord.fileSize,
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
      },
    );

    return savedRecord;
  }

  /**
   * Enqueue a profile enrichment job for the given user.
   * Called when all profile questions are answered so enrichment runs in the
   * background without blocking the HTTP response.
   */
  async addProfileEnrichmentJob(userId: string): Promise<void> {
    const queueMessage = await this.queueService.createQueueJob({
      queueName: 'profile_enrichment',
      jobType: 'enrich_profile',
      userId,
      payload: { userId },
      priority: QueueMessagePriority.NORMAL,
    });

    const job = await this.profileEnrichmentQueue.add(
      'enrich_profile',
      { queueMessageId: queueMessage.id, userId },
      {
        priority: 1,
        delay: 0,
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
      },
    );

    this.logger.log(
      `Enqueued profile enrichment job ${job.id} for user ${userId}`,
      { queueMessageId: queueMessage.id, correlationId: queueMessage.correlationId },
    );
  }

  /**
   * Enqueue a changes diff computation job after resume generation.
   * Runs in the background so users get their PDF without waiting.
   */
  async addChangesDiffJob(
    params: Omit<ChangesDiffJobData, 'queueMessageId'>,
  ): Promise<void> {
    const queueMessage = await this.queueService.createQueueJob({
      queueName: 'changes_diff',
      jobType: 'compute_changes_diff',
      userId: params.userId,
      entityName: 'resume_generations',
      entityId: params.resumeGenerationId,
      payload: {
        resumeGenerationId: params.resumeGenerationId,
      },
      priority: QueueMessagePriority.NORMAL,
    });

    const job = await this.changesDiffQueue.add(
      'compute_changes_diff',
      {
        queueMessageId: queueMessage.id,
        ...params,
      },
      {
        priority: 1,
        delay: 0,
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      },
    );

    this.logger.log(
      `Enqueued changes diff job ${job.id} for resume generation ${params.resumeGenerationId}`,
      { queueMessageId: queueMessage.id, correlationId: queueMessage.correlationId },
    );
  }
}
