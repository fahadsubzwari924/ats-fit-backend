import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserType, UserPlan } from '../../database/entities/user.entity';
import { UserSubscription } from '../../database/entities/user-subscription.entity';
import { UserContext } from '../auth/types/user-context.type';
import {
  RateLimitService,
  SubscriptionPeriod,
} from '../rate-limit/rate-limit.service';
import { IFeatureUsage } from '../../shared/interfaces';
import { NotFoundException } from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { UserMeResponseDto } from './dtos/user-me-response.dto';
import { BetaEntitlementService } from '../beta-access/services/beta-entitlement.service';

export interface IUserContext {
  userId?: string;
  userType: UserType;
  plan: string;
  ipAddress: string;
  userAgent: string;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSubscription)
    private readonly userSubscriptionRepository: Repository<UserSubscription>,
    private readonly rateLimitService: RateLimitService,
    private readonly betaEntitlementService: BetaEntitlementService,
  ) {}

  /**
   * Get user context for authenticated users.
   * Beta users with an active `beta_access_until` are treated as PREMIUM:
   * both `isPremium` and `plan` reflect premium status for guard and
   * rate-limit checks, while the stored `user.plan` column is unchanged.
   */
  async getAuthenticatedUserContext(userId: string): Promise<UserContext> {
    const user = await this.userRepository.findOne({
      where: { id: userId, is_active: true },
    });

    if (!user) {
      throw new NotFoundException('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    const isPremium =
      user.plan === UserPlan.PREMIUM ||
      (await this.betaEntitlementService.hasActiveBetaAccess(user.id));

    return {
      userId: user.id,
      userType: UserType.REGISTERED,
      plan: isPremium ? UserPlan.PREMIUM : user.plan,
      isPremium,
      ipAddress: user.ip_address || '',
      userAgent: user.user_agent || '',
    };
  }

  /**
   * Update user's IP address and user agent
   */
  async updateUserSessionInfo(
    userId: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<void> {
    await this.userRepository.update(userId, {
      ip_address: ipAddress,
      user_agent: userAgent,
    });
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id: userId, is_active: true },
    });
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email, is_active: true },
    });
  }

  /**
   * Mark the user's onboarding as completed.
   * Returns the updated user for the auth response.
   */
  async markOnboardingComplete(userId: string): Promise<User> {
    await this.userRepository.update(userId, { onboarding_completed: true });

    const user = await this.userRepository.findOne({
      where: { id: userId, is_active: true },
      relations: ['uploadedResumes'],
    });
    if (!user) {
      throw new NotFoundException('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    return user;
  }

  /**
   * Get feature usage for a user by user ID.
   * Delegates to `getFeatureUsageForUser` which resolves the correct billing
   * period (subscription-based for premium, calendar-month for freemium).
   *
   * @param userId User ID
   * @returns Formatted feature usage array
   */
  async getUserFeatureUsage(userId: string): Promise<Array<IFeatureUsage>> {
    const user = await this.getUserById(userId);
    if (!user) {
      throw new NotFoundException('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    return this.getFeatureUsageForUser(user);
  }

  /**
   * Upgrade user to premium plan when subscription payment succeeds.
   * Also resets all usage-tracking counters for the current period so the
   * user starts their new billing cycle with zero usage.
   */
  async upgradeToPremium(userId: string): Promise<void> {
    await this.userRepository.update(userId, { plan: UserPlan.PREMIUM });
    await this.rateLimitService.resetUsageForUser(userId);
    this.logger.log(`User ${userId} upgraded to PREMIUM plan, usage reset`);
  }

  /**
   * Downgrade user to freemium when subscription is cancelled or expired.
   */
  async downgradeToFreemium(userId: string): Promise<void> {
    await this.userRepository.update(userId, { plan: UserPlan.FREEMIUM });
    this.logger.log(`User ${userId} downgraded to FREEMIUM plan`);
  }

  /**
   * Get current authenticated user profile with feature usage and uploaded resumes.
   */
  async getCurrentUser(userId: string): Promise<UserMeResponseDto> {
    const user = await this.userRepository.findOne({
      where: { id: userId, is_active: true },
      relations: ['uploadedResumes'],
    });

    if (!user) {
      throw new NotFoundException('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    const featureUsage = await this.getFeatureUsageForUser(user);

    return {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      plan: user.plan,
      isPremium: user.plan === UserPlan.PREMIUM,
      user_type: user.user_type,
      is_active: user.is_active,
      onboarding_completed: user.onboarding_completed,
      created_at: user.created_at,
      updated_at: user.updated_at,
      featureUsage,
      uploadedResumes: user.uploadedResumes ?? [],
    };
  }

  /**
   * Get feature usage for a user entity - Internal reusable method.
   *
   * For premium users, resolves the active subscription period so the
   * rate-limit service can return the correct `resetDate`, `cycleStart`,
   * and `daysRemaining` anchored to the real payment date rather than the
   * calendar month.
   *
   * @param user User entity
   * @returns Formatted feature usage array
   */
  async getFeatureUsageForUser(user: User): Promise<Array<IFeatureUsage>> {
    const userContext: UserContext = {
      userId: user.id,
      userType: user.user_type,
      plan: user.plan,
      ipAddress: user.ip_address || '127.0.0.1',
      userAgent: user.user_agent || 'UserService',
    };

    const subscriptionPeriod =
      user.plan === UserPlan.PREMIUM
        ? await this.getActivePremiumPeriod(user.id)
        : null;

    return this.rateLimitService.getFormattedFeatureUsage(
      userContext,
      subscriptionPeriod,
    );
  }

  /**
   * Retrieve the billing period boundaries for the user's active premium subscription.
   * Returns `null` when no active subscription is found (graceful fallback to calendar month).
   */
  private async getActivePremiumPeriod(
    userId: string,
  ): Promise<SubscriptionPeriod | null> {
    const subscription = await this.userSubscriptionRepository.findOne({
      where: { user_id: userId, is_active: true, is_cancelled: false },
      order: { created_at: 'DESC' },
      select: ['starts_at', 'ends_at'],
    });

    if (!subscription?.starts_at || !subscription?.ends_at) {
      return null;
    }

    return { starts_at: subscription.starts_at, ends_at: subscription.ends_at };
  }
}
