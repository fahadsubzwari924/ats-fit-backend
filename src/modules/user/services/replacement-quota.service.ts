import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSubscription } from '../../../database/entities/user-subscription.entity';
import { SubscriptionPlan } from '../../../database/entities/subscription-plan.entity';
import { User, UserPlan } from '../../../database/entities/user.entity';
import { BillingCycle } from '../../subscription/enums/billing-cycle.enum';
import { RESUME_REPLACEMENT } from '../../../shared/constants/resume-replacement.constants';
import { ResumeReplacementErrorCode } from '../../../shared/enums/resume-replacement.enum';
import { IReplacementQuota } from '../interfaces/replacement-quota.interface';
import { ResumeReplacementAuditRepository } from '../repositories/resume-replacement-audit.repository';
import { BetaEntitlementService } from '../../beta-access/services/beta-entitlement.service';
import {
  ForbiddenException,
  TooManyRequestsException,
} from '../../../shared/exceptions/custom-http-exceptions';

@Injectable()
export class ReplacementQuotaService {
  private readonly logger = new Logger(ReplacementQuotaService.name);

  constructor(
    @InjectRepository(UserSubscription)
    private readonly userSubscriptionRepository: Repository<UserSubscription>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly auditRepository: ResumeReplacementAuditRepository,
    private readonly betaEntitlementService: BetaEntitlementService,
  ) {}

  /**
   * Assert that the user is allowed to perform a resume replacement.
   *
   * Throws ForbiddenException (403) when the user has no active paid
   * subscription (UPGRADE_REQUIRED).
   *
   * Throws TooManyRequestsException (429) when the user has exhausted their
   * monthly replacement quota (REPLACEMENT_QUOTA_EXCEEDED), including the
   * reset timestamp in the exception details.
   */
  async assertCanReplace(userId: string): Promise<void> {
    const subscription = await this.findActiveSubscriptionWithPlan(userId);

    if (!subscription) {
      const isPremium = await this.isPremiumWithoutSubscription(userId);
      if (!isPremium) {
        throw new ForbiddenException(
          'A premium subscription is required to replace your resume.',
          ResumeReplacementErrorCode.UPGRADE_REQUIRED,
        );
      }
      const quota = await this.resolvePremiumCalendarQuota(userId);
      if (quota.used >= quota.limit) {
        this.logger.warn(
          `Replacement quota exceeded for userId=${userId}: used=${quota.used} limit=${quota.limit} resetsAt=${quota.resetsAt.toISOString()}`,
        );
        throw new TooManyRequestsException<{ resetsAt: string }>(
          'Monthly resume replacement limit reached. Please try again after your quota resets.',
          ResumeReplacementErrorCode.REPLACEMENT_QUOTA_EXCEEDED,
          undefined,
          { resetsAt: quota.resetsAt.toISOString() },
        );
      }
      return;
    }

    const quota = await this.resolveQuota(userId, subscription);

    if (quota.used >= quota.limit) {
      this.logger.warn(
        `Replacement quota exceeded for userId=${userId}: used=${quota.used} limit=${quota.limit} resetsAt=${quota.resetsAt.toISOString()}`,
      );
      throw new TooManyRequestsException<{ resetsAt: string }>(
        'Monthly resume replacement limit reached. Please try again after your quota resets.',
        ResumeReplacementErrorCode.REPLACEMENT_QUOTA_EXCEEDED,
        undefined,
        { resetsAt: quota.resetsAt.toISOString() },
      );
    }
  }

  /**
   * Return the current quota state for the user without throwing.
   * Beta users without a subscription get the full premium limit on a
   * calendar-month window. Returns a zero-quota object only for freemium
   * users with neither a subscription nor active beta access.
   */
  async getCurrentQuota(userId: string): Promise<IReplacementQuota> {
    const subscription = await this.findActiveSubscriptionWithPlan(userId);

    if (!subscription) {
      const isPremium = await this.isPremiumWithoutSubscription(userId);
      if (isPremium) {
        return this.resolvePremiumCalendarQuota(userId);
      }
      const now = new Date();
      return {
        used: 0,
        limit: 0,
        windowStart: now,
        resetsAt: now,
      };
    }

    return this.resolveQuota(userId, subscription);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * True when a user has premium entitlement but no subscription row —
   * covers both manually-set plan='premium' and active beta access.
   */
  private async isPremiumWithoutSubscription(userId: string): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'plan', 'is_beta_user', 'beta_access_until'],
    });
    if (!user) return false;
    if (user.plan === UserPlan.PREMIUM) return true;
    return this.betaEntitlementService.hasActiveBetaAccess(userId);
  }

  /**
   * Premium users without a subscription row get the full quota on a
   * calendar-month window (1st of month → 1st of next month).
   */
  private async resolvePremiumCalendarQuota(
    userId: string,
  ): Promise<IReplacementQuota> {
    const now = new Date();
    const windowStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const resetsAt = addOneMonth(windowStart);
    const used = await this.auditRepository.countSucceededReplacementsInWindow(
      userId,
      windowStart,
    );
    return {
      used,
      limit: RESUME_REPLACEMENT.PREMIUM_MONTHLY_LIMIT,
      windowStart,
      resetsAt,
    };
  }

  /**
   * Load the user's active, non-cancelled subscription together with its
   * related subscription plan (needed to read billing_cycle).
   */
  private async findActiveSubscriptionWithPlan(
    userId: string,
  ): Promise<
    (UserSubscription & { subscription_plan: SubscriptionPlan }) | null
  > {
    const subscription = await this.userSubscriptionRepository.findOne({
      where: { user_id: userId, is_active: true, is_cancelled: false },
      relations: ['subscription_plan'],
      order: { created_at: 'DESC' },
    });

    if (!subscription || !subscription.subscription_plan) {
      return null;
    }

    return subscription as UserSubscription & {
      subscription_plan: SubscriptionPlan;
    };
  }

  /**
   * Resolve the billing window and count quota usage for the given subscription.
   */
  private async resolveQuota(
    userId: string,
    subscription: UserSubscription & { subscription_plan: SubscriptionPlan },
  ): Promise<IReplacementQuota> {
    const billingCycle = subscription.subscription_plan.billing_cycle;

    const { windowStart, resetsAt } =
      billingCycle === BillingCycle.YEARLY
        ? this.resolveYearlyWindow(subscription.starts_at)
        : this.resolveMonthlyWindow(subscription.starts_at);

    const used = await this.auditRepository.countSucceededReplacementsInWindow(
      userId,
      windowStart,
    );

    return {
      used,
      limit: RESUME_REPLACEMENT.PREMIUM_MONTHLY_LIMIT,
      windowStart,
      resetsAt,
    };
  }

  /**
   * For MONTHLY subscriptions: the billing window starts at `starts_at`
   * (LemonSqueezy creates a new subscription row on each renewal, so
   * `starts_at` is the current period start).
   *
   * resetsAt = starts_at + 1 calendar month.
   */
  private resolveMonthlyWindow(startsAt: Date): {
    windowStart: Date;
    resetsAt: Date;
  } {
    const windowStart = new Date(startsAt);
    const resetsAt = addOneMonth(windowStart);
    return { windowStart, resetsAt };
  }

  /**
   * For YEARLY subscriptions: compute the monthly sub-window anchored to the
   * day-of-month of the original `starts_at` (the "anchor day").
   *
   * Algorithm:
   *   1. anchor = day-of-month of starts_at (1-based, UTC)
   *   2. today = current UTC date
   *   3. candidateThisMonth = clamp(anchor, lastDayOf(today.year, today.month))
   *   4. if today.day >= candidateThisMonth.day  →  windowStart = this month's anchor
   *      else                                    →  windowStart = last month's anchor
   *   5. resetsAt = windowStart + 1 calendar month
   */
  private resolveYearlyWindow(startsAt: Date): {
    windowStart: Date;
    resetsAt: Date;
  } {
    const anchorDay = startsAt.getUTCDate(); // e.g. 28, 29, 30, 31
    const now = new Date();
    const todayDay = now.getUTCDate();
    const todayMonth = now.getUTCMonth(); // 0-indexed
    const todayYear = now.getUTCFullYear();

    // Clamp anchor to the last day of the current month.
    const lastDayThisMonth = lastDayOfMonth(todayYear, todayMonth);
    const clampedThisMonth = Math.min(anchorDay, lastDayThisMonth);

    let windowStart: Date;

    if (todayDay >= clampedThisMonth) {
      // Anchor falls on or before today this month → window started this month.
      windowStart = new Date(Date.UTC(todayYear, todayMonth, clampedThisMonth));
    } else {
      // Anchor is still in the future this month → window started last month.
      const prevMonth = todayMonth === 0 ? 11 : todayMonth - 1;
      const prevYear = todayMonth === 0 ? todayYear - 1 : todayYear;
      const lastDayPrevMonth = lastDayOfMonth(prevYear, prevMonth);
      const clampedPrevMonth = Math.min(anchorDay, lastDayPrevMonth);
      windowStart = new Date(Date.UTC(prevYear, prevMonth, clampedPrevMonth));
    }

    const resetsAt = addOneMonth(windowStart);
    return { windowStart, resetsAt };
  }
}

// ---------------------------------------------------------------------------
// Pure date math utilities (module-private)
// ---------------------------------------------------------------------------

/**
 * Return the last day (1-based) of the given year/month (0-indexed month).
 */
function lastDayOfMonth(year: number, month: number): number {
  // Day 0 of the next month === last day of this month.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Return a new Date exactly one calendar month after `date`, clamping to the
 * last day of the target month when the source day exceeds it.
 */
function addOneMonth(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth(); // 0-indexed
  const day = date.getUTCDate();

  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  const clampedDay = Math.min(day, lastDayOfMonth(nextYear, nextMonth));

  return new Date(Date.UTC(nextYear, nextMonth, clampedDay));
}
