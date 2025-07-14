import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UsageTracking,
  FeatureType,
} from '../../database/entities/usage-tracking.entity';
import { RateLimitConfig } from '../../database/entities/rate-limit-config.entity';
import { IUserContext } from '../user/user.service';
import { UserPlan, UserType } from '../../database/entities/user.entity';
import { BadRequestException } from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { UserContext } from '../auth/types/user-context.type';

export interface RateLimitResult {
  allowed: boolean;
  currentUsage: number;
  limit: number;
  remaining: number;
  resetDate: Date;
}

@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly cache = new Map<
    string,
    { usage: number; lastUpdated: number }
  >();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    @InjectRepository(UsageTracking)
    private readonly usageTrackingRepository: Repository<UsageTracking>,
    @InjectRepository(RateLimitConfig)
    private readonly rateLimitConfigRepository: Repository<RateLimitConfig>,
  ) {}

  /**
   * Check if a user can use a specific feature
   */
  async checkRateLimit(
    userContext: UserContext,
    featureType: FeatureType,
  ): Promise<RateLimitResult> {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Get rate limit configuration
    const config = await this.getRateLimitConfig(
      userContext.plan as UserPlan,
      userContext.userType as UserType,
      featureType,
    );

    if (!config) {
      throw new BadRequestException(
        `Rate limit configuration not found for ${featureType}`,
        ERROR_CODES.BAD_REQUEST,
        undefined,
        {
          plan: userContext.plan,
          userType: userContext.userType,
          featureType,
        },
      );
    }

    // Get current usage
    const currentUsage = await this.getCurrentUsage(
      userContext,
      featureType,
      currentMonth,
      currentYear,
    );

    // Check if limit exceeded
    const allowed = currentUsage < config.monthly_limit;
    const remaining = Math.max(0, config.monthly_limit - currentUsage);

    // Calculate reset date (first day of next month)
    const resetDate = new Date(currentYear, currentMonth, 1);

    return {
      allowed,
      currentUsage,
      limit: config.monthly_limit,
      remaining,
      resetDate,
    };
  }

  /**
   * Record usage for a feature
   */
  async recordUsage(
    userContext: UserContext,
    featureType: FeatureType,
  ): Promise<void> {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    // Find existing usage record
    let usageRecord = await this.usageTrackingRepository.findOne({
      where: this.buildUsageQuery(
        userContext,
        featureType,
        currentMonth,
        currentYear,
      ) as Partial<UsageTracking>,
    });

    if (usageRecord) {
      // Update existing record
      usageRecord.usage_count += 1;
      usageRecord.last_used_at = now;
    } else {
      // Create new record
      usageRecord = this.usageTrackingRepository.create({
        user_id: userContext.userId,
        guest_id: userContext.guestId,
        ip_address: userContext.ipAddress,
        feature_type: featureType,
        month: currentMonth,
        year: currentYear,
        usage_count: 1,
        last_used_at: now,
      });
    }

    await this.usageTrackingRepository.save(usageRecord);

    // Update cache
    const cacheKey = this.buildCacheKey(
      userContext,
      featureType,
      currentMonth,
      currentYear,
    );
    this.cache.set(cacheKey, {
      usage: usageRecord.usage_count,
      lastUpdated: Date.now(),
    });

    this.logger.log(
      `Usage recorded for ${featureType}: ${userContext.userType} user, count: ${usageRecord.usage_count}`,
    );
  }

  /**
   * Get current usage for a user and feature
   */
  private async getCurrentUsage(
    userContext: UserContext,
    featureType: FeatureType,
    month: number,
    year: number,
  ): Promise<number> {
    // Check cache first
    const cacheKey = this.buildCacheKey(userContext, featureType, month, year);
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.lastUpdated < this.CACHE_TTL) {
      return cached.usage;
    }

    // Query database
    const usageRecord = await this.usageTrackingRepository.findOne({
      where: this.buildUsageQuery(
        userContext,
        featureType,
        month,
        year,
      ) as Partial<UsageTracking>,
    });

    const usage = usageRecord?.usage_count || 0;

    // Update cache
    this.cache.set(cacheKey, {
      usage,
      lastUpdated: Date.now(),
    });

    return usage;
  }

  /**
   * Get rate limit configuration
   */
  private async getRateLimitConfig(
    plan: UserPlan,
    userType: UserType,
    featureType: FeatureType,
  ): Promise<RateLimitConfig | null> {
    return this.rateLimitConfigRepository.findOne({
      where: {
        plan,
        user_type: userType,
        feature_type: featureType,
        is_active: true,
      },
    });
  }

  /**
   * Build query for usage tracking
   */
  private buildUsageQuery(
    userContext: UserContext,
    featureType: FeatureType,
    month: number,
    year: number,
  ): Record<string, unknown> {
    const query: Record<string, unknown> = {
      feature_type: featureType,
      month,
      year,
    };

    const identifierMap: [keyof IUserContext, string][] = [
      ['userId', 'user_id'],
      ['guestId', 'guest_id'],
      ['ipAddress', 'ip_address'],
    ];

    for (const [contextKey, queryKey] of identifierMap) {
      if (userContext[contextKey]) {
        query[queryKey] = userContext[contextKey];
        break;
      }
    }

    return query;
  }

  /**
   * Build cache key
   */
  private buildCacheKey(
    userContext: UserContext,
    featureType: FeatureType,
    month: number,
    year: number,
  ): string {
    const identifier: string = String(
      userContext.userId ?? userContext.guestId ?? userContext.ipAddress ?? '',
    );
    return `${identifier}:${featureType}:${month}:${year}`;
  }

  /**
   * Get usage statistics for a user
   */
  async getUserUsageStats(userContext: UserContext): Promise<{
    resume_generation: RateLimitResult;
    ats_score: RateLimitResult;
  }> {
    const [resumeGeneration, atsScore] = await Promise.all([
      this.checkRateLimit(userContext, FeatureType.RESUME_GENERATION),
      this.checkRateLimit(userContext, FeatureType.ATS_SCORE),
    ]);

    return {
      resume_generation: resumeGeneration,
      ats_score: atsScore,
    };
  }

  /**
   * Clean up old cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.lastUpdated > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Initialize rate limit configurations if they don't exist
   */
  async initializeRateLimitConfigs(): Promise<void> {
    const configs = [
      // Freemium - Guest users
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.GUEST,
        feature_type: FeatureType.RESUME_GENERATION,
        monthly_limit: 2,
        description: 'Freemium guest users can generate 2 resumes per month',
      },
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.GUEST,
        feature_type: FeatureType.ATS_SCORE,
        monthly_limit: 5,
        description:
          'Freemium guest users can check ATS score 5 times per month',
      },
      // Freemium - Registered users
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_GENERATION,
        monthly_limit: 5,
        description:
          'Freemium registered users can generate 5 resumes per month',
      },
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.ATS_SCORE,
        monthly_limit: 10,
        description:
          'Freemium registered users can check ATS score 10 times per month',
      },
      // Premium - Registered users (future use)
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_GENERATION,
        monthly_limit: 50,
        description: 'Premium users can generate 50 resumes per month',
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.ATS_SCORE,
        monthly_limit: 100,
        description: 'Premium users can check ATS score 100 times per month',
      },
    ];

    for (const config of configs) {
      const existing = await this.rateLimitConfigRepository.findOne({
        where: {
          plan: config.plan,
          user_type: config.user_type,
          feature_type: config.feature_type,
        },
      });

      if (!existing) {
        await this.rateLimitConfigRepository.save(config);
        this.logger.log(`Created rate limit config: ${config.description}`);
      }
    }
  }
}
