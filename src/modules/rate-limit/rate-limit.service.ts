import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  UsageTracking,
  FeatureType,
} from '../../database/entities/usage-tracking.entity';
import { RateLimitConfig } from '../../database/entities/rate-limit-config.entity';
import { UserPlan, UserType } from '../../database/entities/user.entity';
import { BadRequestException } from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { UserContext } from '../auth/types/user-context.type';
import {
  FormattedFeatureUsage,
  RateLimitResult,
  UserUsageStats,
} from './interfaces/rate-limit.interfaces';

export type { RateLimitResult, FormattedFeatureUsage, UserUsageStats };

/** Billing period boundaries surfaced from an active UserSubscription. */
export interface SubscriptionPeriod {
  starts_at: Date;
  ends_at: Date;
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
    const config = await this.getRateLimitConfig(
      userContext.plan as UserPlan,
      userContext.userType as UserType,
      featureType,
    );

    if (!config) {
      throw new BadRequestException(
        `Rate limit configuration not found for ${featureType}`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

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

    // Calculate usage percentage (rounded to whole number)
    const usagePercentage = Math.round(
      (currentUsage / config.monthly_limit) * 100,
    );

    // For guard-level enforcement, use calendar-month boundaries.
    const cycleStart = new Date(currentYear, currentMonth - 1, 1);
    const resetDate = new Date(currentYear, currentMonth, 1);

    return {
      allowed,
      currentUsage,
      limit: config.monthly_limit,
      remaining,
      resetDate,
      cycleStart,
      usagePercentage,
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
   * Fetch all rate-limit configs for a given plan/userType/featureTypes in one DB call.
   */
  private async getRateLimitConfigsBatch(
    plan: UserPlan,
    userType: UserType,
    featureTypes: FeatureType[],
  ): Promise<Map<FeatureType, RateLimitConfig>> {
    const configs = await this.rateLimitConfigRepository.find({
      where: {
        plan,
        user_type: userType,
        feature_type: In(featureTypes),
        is_active: true,
      },
    });

    const configMap = new Map<FeatureType, RateLimitConfig>();
    for (const config of configs) {
      configMap.set(config.feature_type, config);
    }
    return configMap;
  }

  /**
   * Fetch all usage records for a set of features in one DB call.
   * Returns a map of featureType → usage count (0 when no record exists).
   */
  private async getCurrentUsageBatch(
    userContext: UserContext,
    featureTypes: FeatureType[],
    month: number,
    year: number,
  ): Promise<Map<FeatureType, number>> {
    const usageMap = new Map<FeatureType, number>(
      featureTypes.map((ft) => [ft, 0]),
    );

    const records = await this.usageTrackingRepository.find({
      where: {
        user_id: userContext.userId,
        feature_type: In(featureTypes),
        month,
        year,
      },
    });

    for (const record of records) {
      usageMap.set(record.feature_type, record.usage_count);
    }

    return usageMap;
  }

  /**
   * Get rate limit configuration
   */
  public async getRateLimitConfig(
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

    if (userContext.userId) {
      query.user_id = userContext.userId;
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
    const identifier: string = String(userContext.userId ?? '');
    return `${identifier}:${featureType}:${month}:${year}`;
  }

  /**
   * Compute a RateLimitResult from pre-fetched config and usage maps.
   * Throws BadRequestException if config is missing (data integrity error).
   */
  private computeRateLimitResult(
    featureType: FeatureType,
    configMap: Map<FeatureType, RateLimitConfig>,
    usageMap: Map<FeatureType, number>,
    period: { cycleStart: Date; cycleEnd: Date },
  ): RateLimitResult {
    const config = configMap.get(featureType);
    if (!config) {
      throw new BadRequestException(
        `Rate limit configuration not found for ${featureType}`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const currentUsage = usageMap.get(featureType) ?? 0;
    const remaining = Math.max(0, config.monthly_limit - currentUsage);
    const usagePercentage = Math.round(
      (currentUsage / config.monthly_limit) * 100,
    );

    return {
      allowed: currentUsage < config.monthly_limit,
      currentUsage,
      limit: config.monthly_limit,
      remaining,
      resetDate: period.cycleEnd,
      cycleStart: period.cycleStart,
      usagePercentage,
    };
  }

  /**
   * Get usage statistics for a user.
   * Issues exactly 2 parallel DB calls regardless of plan tier.
   *
   * FREEMIUM: resume_generation + cover_letter — period is the current calendar month.
   * PREMIUM:  resume_generation + cover_letter + resume_batch_generation
   *           — period is derived from the active subscription when provided,
   *             falling back to the current calendar month otherwise.
   *
   * @param subscriptionPeriod Active subscription boundaries for premium users.
   *   Pass `null` / omit for freemium or when no subscription record exists yet.
   */
  async getUserUsageStats(
    userContext: UserContext,
    subscriptionPeriod?: SubscriptionPeriod | null,
  ): Promise<UserUsageStats> {
    const isPremium = (userContext.plan as UserPlan) === UserPlan.PREMIUM;

    const featureTypes: FeatureType[] = isPremium
      ? [
          FeatureType.RESUME_GENERATION,
          FeatureType.COVER_LETTER,
          FeatureType.RESUME_BATCH_GENERATION,
        ]
      : [FeatureType.RESUME_GENERATION, FeatureType.COVER_LETTER];

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const period = this.resolveBillingPeriod(
      now,
      currentMonth,
      currentYear,
      isPremium ? subscriptionPeriod : null,
    );

    const [configMap, usageMap] = await Promise.all([
      this.getRateLimitConfigsBatch(
        userContext.plan as UserPlan,
        userContext.userType as UserType,
        featureTypes,
      ),
      this.getCurrentUsageBatch(
        userContext,
        featureTypes,
        currentMonth,
        currentYear,
      ),
    ]);

    const result: UserUsageStats = {
      resume_generation: this.computeRateLimitResult(
        FeatureType.RESUME_GENERATION,
        configMap,
        usageMap,
        period,
      ),
      cover_letter: this.computeRateLimitResult(
        FeatureType.COVER_LETTER,
        configMap,
        usageMap,
        period,
      ),
    };

    if (isPremium) {
      result.resume_batch_generation = this.computeRateLimitResult(
        FeatureType.RESUME_BATCH_GENERATION,
        configMap,
        usageMap,
        period,
      );
    }

    return result;
  }

  /**
   * Get formatted feature usage for API responses.
   * FREEMIUM: resume_generation + cover_letter
   * PREMIUM:  resume_generation + cover_letter + resume_batch_generation
   *
   * @param subscriptionPeriod Active subscription boundaries for premium users.
   *   Pass `null` / omit for freemium or when no subscription record exists yet.
   */
  async getFormattedFeatureUsage(
    userContext: UserContext,
    subscriptionPeriod?: SubscriptionPeriod | null,
  ): Promise<FormattedFeatureUsage[]> {
    const stats = await this.getUserUsageStats(userContext, subscriptionPeriod);

    const toEntry = (
      feature: FeatureType,
      result: RateLimitResult,
    ): FormattedFeatureUsage => ({
      feature,
      allowed: result.limit,
      remaining: result.remaining,
      used: result.currentUsage,
      usagePercentage: `${result.usagePercentage}%`,
      resetDate: result.resetDate,
      cycleStart: result.cycleStart,
      daysRemaining: this.computeDaysRemaining(result.resetDate),
    });

    const entries: FormattedFeatureUsage[] = [
      toEntry(FeatureType.RESUME_GENERATION, stats.resume_generation),
      toEntry(FeatureType.COVER_LETTER, stats.cover_letter),
    ];

    if (stats.resume_batch_generation) {
      entries.push(
        toEntry(
          FeatureType.RESUME_BATCH_GENERATION,
          stats.resume_batch_generation,
        ),
      );
    }

    return entries;
  }

  /**
   * Reset all usage-tracking records for a user in the current calendar month.
   * Called when a user upgrades to a new plan so they begin the new cycle with
   * zero usage rather than carrying over usage from their previous plan.
   */
  async resetUsageForUser(userId: string): Promise<void> {
    const now = new Date();
    await this.usageTrackingRepository.delete({
      user_id: userId,
      month: now.getMonth() + 1,
      year: now.getFullYear(),
    });

    // Evict any in-memory cache entries for this user so stale counts are not served.
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.cache.delete(key);
      }
    }

    this.logger.log(`Usage reset for user ${userId} on plan upgrade`);
  }

  /**
   * Derive the billing period boundaries to use for display and progress calculation.
   *
   * Priority (highest to lowest):
   *  1. Active subscription period (premium only) — anchors to the real payment date.
   *  2. Calendar-month fallback — first day of current month → first day of next month.
   */
  private resolveBillingPeriod(
    now: Date,
    currentMonth: number,
    currentYear: number,
    subscriptionPeriod?: SubscriptionPeriod | null,
  ): { cycleStart: Date; cycleEnd: Date } {
    if (subscriptionPeriod?.starts_at && subscriptionPeriod?.ends_at) {
      return {
        cycleStart: subscriptionPeriod.starts_at,
        cycleEnd: subscriptionPeriod.ends_at,
      };
    }

    return {
      cycleStart: new Date(currentYear, currentMonth - 1, 1),
      cycleEnd: new Date(currentYear, currentMonth, 1),
    };
  }

  /**
   * Compute whole days remaining from now until the cycle end date (≥ 0).
   */
  private computeDaysRemaining(cycleEnd: Date): number {
    const msRemaining = cycleEnd.getTime() - Date.now();
    return Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
  }

  /**
   * Initialize rate limit configurations if they don't exist.
   *
   * Canonical set (5 configs):
   *   FREEMIUM / RESUME_GENERATION        → 3
   *   FREEMIUM / COVER_LETTER             → 1
   *   PREMIUM  / RESUME_GENERATION        → 30
   *   PREMIUM  / COVER_LETTER             → 15
   *   PREMIUM  / RESUME_BATCH_GENERATION  → 10
   *
   * Intentional omissions:
   *   - FREEMIUM / RESUME_BATCH_GENERATION: blocked at route level by PremiumUserGuard
   *   - JOB_APPLICATION_TRACKING: unlimited for all plans; no @RateLimitFeature usage
   */
  async initializeRateLimitConfigs(): Promise<void> {
    const configs = [
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_GENERATION,
        monthly_limit: 3,
        description: 'Freemium users can generate 3 resumes per month',
      },
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.COVER_LETTER,
        monthly_limit: 1,
        description: 'Freemium users can generate 1 cover letter per month',
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_GENERATION,
        monthly_limit: 30,
        description: 'Premium users can generate 30 resumes per month',
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.COVER_LETTER,
        monthly_limit: 15,
        description: 'Premium users can generate 15 cover letters per month',
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_BATCH_GENERATION,
        monthly_limit: 10,
        description: 'Premium users can run 10 batch generations per month',
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
