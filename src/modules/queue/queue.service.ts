import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  QueueMessage,
  QueueMessageStatus,
  QueueMessagePriority,
} from '../../database/entities/queue-message.entity';
import { ExtractedResumeContent } from '../../database/entities/extracted-resume-content.entity';
import { TailoredContent } from '../resume/interfaces/resume-extracted-keywords.interface';
import { ResumeProcessingJobData } from './resume-processing.processor';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export interface CreateQueueJobOptions {
  queueName: string;
  jobType: string;
  userId?: string;
  entityName?: string;
  entityId?: string;
  payload: Record<string, any>;
  priority?: QueueMessagePriority;
  correlationId?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue('resume_processing')
    private readonly resumeProcessingQueue: Queue<ResumeProcessingJobData>,
    @InjectRepository(QueueMessage)
    private readonly queueMessageRepository: Repository<QueueMessage>,
    @InjectRepository(ExtractedResumeContent)
    private readonly extractedResumeRepository: Repository<ExtractedResumeContent>,
  ) {}

  /**
   * Universal method to create and track any queue job
   * Following Single Responsibility Principle - handles queue message creation and tracking
   */
  async createQueueJob(options: CreateQueueJobOptions): Promise<QueueMessage> {
    const {
      queueName,
      jobType,
      userId,
      entityName,
      entityId,
      payload,
      priority = 'normal',
      correlationId,
      metadata = {},
    } = options;

    // Create queue message record for tracking
    const queueMessage = this.queueMessageRepository.create({
      queueName,
      jobType,
      correlationId: correlationId || uuidv4(),
      userId,
      entityName,
      entityId,
      payload,
      priority,
      metadata,
      status: 'queued',
    });

    const savedQueueMessage =
      await this.queueMessageRepository.save(queueMessage);

    this.logger.log(
      `Created queue message ${savedQueueMessage.id} for ${queueName}:${jobType}`,
      {
        queueMessageId: savedQueueMessage.id,
        correlationId: savedQueueMessage.correlationId,
        userId,
        entityName,
        entityId,
      },
    );

    return savedQueueMessage;
  }

  /**
   * Add resume processing job with proper queue tracking
   */
  async addResumeProcessingJob(
    userId: string,
    fileName: string,
    fileBuffer: Buffer,
  ): Promise<ExtractedResumeContent> {
    const fileSize = fileBuffer.length;
    const fileHash = this.generateFileHash(fileBuffer);

    // Check if this file has already been processed
    const existingContent = await this.extractedResumeRepository.findOne({
      where: { fileHash, userId },
    });

    if (existingContent) {
      this.logger.log(
        `Resume with hash ${fileHash} already exists for user ${userId}`,
      );
      return existingContent;
    }

    // Create queue message for tracking
    const queueMessage = await this.createQueueJob({
      queueName: 'resume_processing',
      jobType: 'extract_resume_content',
      userId,
      entityName: 'extracted_resume_content',
      payload: {
        fileName,
        fileSize,
        fileHash,
        fileBuffer: fileBuffer.toString('base64'), // Store as base64 for JSON compatibility
      },
      priority: 'normal',
      metadata: {
        originalFileName: fileName,
        fileSize,
        fileHash,
      },
    });

    // Create business entity with reference to queue message
    const newRecord = this.extractedResumeRepository.create({
      userId,
      queueMessageId: queueMessage.id,
      originalFileName: fileName,
      fileSize,
      fileHash,
      extractedText: '', // Will be populated by the processor
      structuredContent: {} as TailoredContent, // Will be populated by the processor
      usageCount: 0,
    });

    const savedRecord = await this.extractedResumeRepository.save(newRecord);

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
   * Update queue message status with proper audit trail
   */
  async updateQueueMessageStatus(
    queueMessageId: string,
    status: QueueMessageStatus,
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

    // Increment attempts using raw query to avoid TypeScript issues
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
   * Get queue message by ID
   */
  async getQueueMessage(queueMessageId: string): Promise<QueueMessage | null> {
    return this.queueMessageRepository.findOne({
      where: { id: queueMessageId },
    });
  }

  /**
   * Get all extracted resumes for a user
   */
  async getUserExtractedResumes(
    userId: string,
  ): Promise<ExtractedResumeContent[]> {
    return this.extractedResumeRepository.find({
      where: { userId },
      relations: ['queueMessage'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get a specific extracted resume by ID and user ID
   */
  async getUserExtractedResume(
    resumeId: string,
    userId: string,
  ): Promise<ExtractedResumeContent | null> {
    const resume = await this.extractedResumeRepository.findOne({
      where: { id: resumeId, userId },
      relations: ['queueMessage'],
    });

    if (resume) {
      // Update usage statistics
      resume.incrementUsageCount();
      await this.extractedResumeRepository.save(resume);
    }

    return resume;
  }

  /**
   * Delete an extracted resume and its queue message
   */
  async deleteExtractedResume(
    resumeId: string,
    userId: string,
  ): Promise<boolean> {
    const resume = await this.extractedResumeRepository.findOne({
      where: { id: resumeId, userId },
      relations: ['queueMessage'],
    });

    if (!resume) {
      return false;
    }

    // Delete business entity (queue message will be cascade deleted or kept for audit)
    await this.extractedResumeRepository.delete({ id: resumeId, userId });

    this.logger.log(`Deleted extracted resume ${resumeId} for user ${userId}`, {
      queueMessageId: resume.queueMessageId,
    });

    return true;
  }

  /**
   * Get comprehensive queue statistics
   */
  async getQueueStats() {
    const bullStats = await this.getBullQueueStats();
    const dbStats = await this.getDatabaseQueueStats();

    return {
      bull: bullStats,
      database: dbStats,
    };
  }

  /**
   * Generate file hash for deduplication
   */
  private generateFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Get Bull queue statistics
   */
  private async getBullQueueStats() {
    const [waiting, active, completed, failed] = await Promise.all([
      this.resumeProcessingQueue.getWaiting(),
      this.resumeProcessingQueue.getActive(),
      this.resumeProcessingQueue.getCompleted(),
      this.resumeProcessingQueue.getFailed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
    };
  }

  /**
   * Get database queue statistics
   */
  private async getDatabaseQueueStats(): Promise<
    Record<
      string,
      Record<string, { count: number; avgDurationMs: number | null }>
    >
  > {
    interface StatResult {
      status: string;
      queueName: string;
      count: string;
      avgDurationMs: string | null;
    }

    const stats = await this.queueMessageRepository
      .createQueryBuilder('qm')
      .select('qm.status', 'status')
      .addSelect('qm.queue_name', 'queueName')
      .addSelect('COUNT(*)', 'count')
      .addSelect('AVG(qm.processing_duration_ms)', 'avgDurationMs')
      .groupBy('qm.status, qm.queue_name')
      .getRawMany<StatResult>();

    return stats.reduce(
      (
        acc: Record<
          string,
          Record<string, { count: number; avgDurationMs: number | null }>
        >,
        stat: StatResult,
      ) => {
        acc[stat.queueName] = acc[stat.queueName] || {};
        acc[stat.queueName][stat.status] = {
          count: parseInt(stat.count, 10),
          avgDurationMs: stat.avgDurationMs
            ? parseFloat(stat.avgDurationMs)
            : null,
        };
        return acc;
      },
      {},
    );
  }
}
