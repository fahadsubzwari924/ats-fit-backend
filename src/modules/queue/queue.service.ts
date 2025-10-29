import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueMessage } from '../../database/entities/queue-message.entity';
import {
  QueueMessageStatus,
  QueueMessagePriority,
} from '../../shared/enums/queue-message.enum';
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
    @InjectRepository(QueueMessage)
    private readonly queueMessageRepository: Repository<QueueMessage>,
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
      priority = QueueMessagePriority.NORMAL,
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
      status: QueueMessageStatus.QUEUED,
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

    if (status === QueueMessageStatus.PROCESSING) {
      updateData.startedAt = new Date();
    }

    if (
      status === QueueMessageStatus.COMPLETED ||
      status === QueueMessageStatus.FAILED
    ) {
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
   * Get database queue statistics
   * Returns statistics grouped by queue name and status
   */
  async getDatabaseQueueStats(): Promise<
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
