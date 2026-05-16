import { Injectable, Inject, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type IORedis from 'ioredis';
import { JOB_RELEVANCE_CONSTANTS } from '../constants/job-relevance.constants';
import type { JobRelevanceResult } from '../interfaces/job-relevance.interface';

@Injectable()
export class JobRelevanceCacheService {
  private readonly logger = new Logger(JobRelevanceCacheService.name);

  constructor(
    @Inject(JOB_RELEVANCE_CONSTANTS.DB.REDIS_PROVIDER_TOKEN)
    private readonly redis: IORedis,
  ) {}

  buildKey(profileVersion: number, jobDescription: string): string {
    const normalized = jobDescription.trim().replace(/\s+/g, ' ').toLowerCase();
    const hash = createHash('sha1').update(normalized).digest('hex');
    return `${JOB_RELEVANCE_CONSTANTS.CACHE.KEY_PREFIX}:${profileVersion}:${hash}`;
  }

  async get(key: string): Promise<JobRelevanceResult | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as JobRelevanceResult;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async set(key: string, value: JobRelevanceResult): Promise<void> {
    try {
      await this.redis.set(
        key,
        JSON.stringify(value),
        'EX',
        JOB_RELEVANCE_CONSTANTS.CACHE.TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${key}: ${(err as Error).message}`,
      );
    }
  }
}
