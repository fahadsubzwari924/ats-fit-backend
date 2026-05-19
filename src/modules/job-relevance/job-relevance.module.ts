import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { JobRelevanceService } from './job-relevance.service';
import { JobRelevanceCacheService } from './cache/job-relevance-cache.service';
import { JobRelevanceKeywordFastPathService } from './fast-path/job-relevance-keyword-fast-path.service';
import { JobRelevanceLlmClient } from './clients/job-relevance-llm.client';
import { JOB_RELEVANCE_CONSTANTS } from './constants/job-relevance.constants';
import { ResumeTailoringModule } from '../resume-tailoring/resume-tailoring.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [
    forwardRef(() => ResumeTailoringModule),
    // RateLimitModule must be lazily resolved — the import graph cycles
    // through RateLimitModule → UserModule → ResumeTailoringModule → back
    // here. Without forwardRef, NestJS scans this module before
    // RateLimitModule's export evaluates, leaving imports[1] = undefined.
    forwardRef(() => RateLimitModule),
  ],
  providers: [
    {
      provide: JOB_RELEVANCE_CONSTANTS.DB.REDIS_PROVIDER_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new IORedis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          db: config.get<number>('REDIS_DB', 0),
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        }),
    },
    JobRelevanceCacheService,
    JobRelevanceKeywordFastPathService,
    JobRelevanceLlmClient,
    JobRelevanceService,
  ],
  exports: [JobRelevanceService],
})
export class JobRelevanceModule {}
