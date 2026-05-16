import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BatchTailoringRun } from '../../../database/entities/batch-tailoring-run.entity';
import { BatchTailoringJob } from '../../../database/entities/batch-tailoring-job.entity';
import { User } from '../../../database/entities/user.entity';
import { BatchTailoringV2EventsGateway } from './batch-tailoring-v2.events.gateway';
import { BatchTailoringV2Processor } from './batch-tailoring-v2.processor';
import { BatchTailoringV2Service } from './batch-tailoring-v2.service';
import { BatchTailoringV2Controller } from './batch-tailoring-v2.controller';
import { BatchJobErrorClassifierService } from '../services/batch-job-error-classifier.service';
import { BATCH_TAILORING_V2_QUEUE } from './constants/batch-tailoring-v2.constants';
import { ResumeTailoringModule } from '../resume-tailoring.module';
import { AuthModule } from '../../auth/auth.module';
import { RateLimitModule } from '../../rate-limit/rate-limit.module';
import { JobRelevanceModule } from '../../job-relevance/job-relevance.module';

/**
 * BatchTailoringV2Module — owns all Batch-Tailoring V2 infrastructure.
 *
 * Responsibilities:
 * - Registers the `batch_tailoring_v2` Bull queue via the constant (no magic strings)
 * - Registers the two TypeORM entities consumed by the processor
 * - Provides and exports BatchTailoringV2EventsGateway for SSE streaming
 * - Provides BatchTailoringV2Processor as the queue consumer
 * - Provides BatchTailoringV2Service for enqueue + snapshot logic
 * - Mounts BatchTailoringV2Controller for the POST /resume-tailoring/batch/v2/generate route
 *
 * Imports ResumeTailoringModule directly (no forwardRef) to consume
 * ResumeGenerationOrchestratorService. The reverse dependency does not exist —
 * this module is registered in AppModule alongside ResumeTailoringModule rather
 * than being imported by it, which keeps the relationship one-way.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: BATCH_TAILORING_V2_QUEUE }),
    TypeOrmModule.forFeature([BatchTailoringRun, BatchTailoringJob, User]),
    ResumeTailoringModule,
    forwardRef(() => AuthModule),
    forwardRef(() => RateLimitModule),
    JobRelevanceModule,
  ],
  controllers: [BatchTailoringV2Controller],
  providers: [
    BatchTailoringV2EventsGateway,
    BatchTailoringV2Processor,
    BatchTailoringV2Service,
    BatchJobErrorClassifierService,
  ],
  exports: [BatchTailoringV2EventsGateway, BatchTailoringV2Service],
})
export class BatchTailoringV2Module {}
