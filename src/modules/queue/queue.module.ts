import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueMessage } from '../../database/entities/queue-message.entity';
import { QueueService } from './queue.service';

/**
 * Queue Module - Pure Infrastructure
 *
 * Provides universal queue management infrastructure.
 * Does NOT contain domain-specific processors.
 *
 * Domain modules (e.g., ResumeTailoringModule) register their own
 * processors and import this module for queue infrastructure.
 *
 * Following Single Responsibility Principle:
 * - Queue infrastructure only
 * - No business logic
 * - Reusable across domains
 */
@Module({
  imports: [
    // Register Bull queues (infrastructure only)
    BullModule.registerQueue(
      {
        name: 'resume_processing',
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 50,
          removeOnFail: 25,
        },
      },
      {
        name: 'resume-generation',
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      },
    ),

    // TypeORM for queue tracking entity
    TypeOrmModule.forFeature([QueueMessage]),
  ],
  providers: [
    QueueService, // Universal queue management service
  ],
  exports: [
    QueueService, // Export for use by domain modules
    BullModule, // Export Bull queues for domain processors
  ],
})
export class QueueModule {}
