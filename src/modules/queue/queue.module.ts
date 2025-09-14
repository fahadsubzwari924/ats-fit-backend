import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueMessage } from '../../database/entities/queue-message.entity';
import { ExtractedResumeContent } from '../../database/entities/extracted-resume-content.entity';
import { ResumeProcessingProcessor } from './resume-processing.processor';
import { ResumeModule } from '../resume/resume.module';
import { QueueService } from './queue.service';
import { ExtractedResumeService } from '../resume/services/extracted-resume.service';

@Module({
  imports: [
    // Register the resume processing queue only
    BullModule.registerQueue({
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
    }),

    // TypeORM for database entities
    TypeOrmModule.forFeature([QueueMessage, ExtractedResumeContent]),

    // Use forwardRef to prevent circular dependency
    forwardRef(() => ResumeModule),
  ],
  providers: [ResumeProcessingProcessor, QueueService, ExtractedResumeService],
  exports: [QueueService, BullModule],
})
export class QueueModule {}
