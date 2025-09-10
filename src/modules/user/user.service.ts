import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserType, UserPlan } from '../../database/entities/user.entity';
import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';
import { UserContext } from '../auth/types/user-context.type';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { IFeatureUsage } from '../../shared/interfaces';
import { NotFoundException } from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';

export interface IUserContext {
  userId?: string;
  guestId?: string;
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
    private readonly rateLimitService: RateLimitService,
  ) {}

  /**
   * Get or create a guest user based on request information
   */
  async getOrCreateGuestUser(request: Request): Promise<UserContext> {
    const ipAddress = this.extractIpAddress(request);
    const userAgent = request.headers['user-agent'] || '';

    // Try to find existing guest user by IP and user agent
    let guestUser = await this.userRepository.findOne({
      where: {
        user_type: UserType.GUEST,
        ip_address: ipAddress,
        user_agent: userAgent,
        is_active: true,
      },
    });

    if (!guestUser) {
      // Create new guest user
      const guestId = uuidv4();
      guestUser = this.userRepository.create({
        full_name: `Guest_User_${guestId}`,
        email: `guest-${guestId}@ats-fit.com`,
        password: '', // No password for guest users
        user_type: UserType.GUEST,
        plan: UserPlan.FREEMIUM,
        guest_id: guestId,
        ip_address: ipAddress,
        user_agent: userAgent,
        is_active: true,
      });

      await this.userRepository.save(guestUser);
      this.logger.log(`Created new guest user with ID: ${guestId}`);
    }

    return {
      guestId: guestUser.guest_id,
      userType: UserType.GUEST,
      plan: guestUser.plan,
      isPremium: guestUser.plan === UserPlan.PREMIUM,
      ipAddress: guestUser.ip_address,
      userAgent: guestUser.user_agent,
    };
  }

  /**
   * Get user context for authenticated users
   */
  async getAuthenticatedUserContext(userId: string): Promise<UserContext> {
    const user = await this.userRepository.findOne({
      where: { id: userId, is_active: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    return {
      userId: user.id,
      userType: UserType.REGISTERED,
      plan: user.plan,
      isPremium: user.plan === UserPlan.PREMIUM,
      ipAddress: user.ip_address || '',
      userAgent: user.user_agent || '',
    };
  }

  /**
   * Extract IP address from request, handling proxies
   */
  private extractIpAddress(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'] as string;
    if (forwardedFor) {
      return forwardedFor.split(',')[0].trim();
    }

    const realIp = request.headers['x-real-ip'] as string;
    if (realIp) {
      return realIp;
    }

    return request.ip || request.connection.remoteAddress || 'unknown';
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
   * Get user by guest ID
   */
  async getUserByGuestId(guestId: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { guest_id: guestId, is_active: true },
    });
  }

  /**
   * Get feature usage for a user by user ID - Reusable method
   * This method can be used by login API and dedicated feature usage endpoint
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
   * Get feature usage for a user entity - Internal reusable method
   * This follows the DRY principle and Single Responsibility Principle
   * @param user User entity
   * @returns Formatted feature usage array
   */
  async getFeatureUsageForUser(user: User): Promise<Array<IFeatureUsage>> {
    const userContext: UserContext = {
      userId: user.id,
      userType: user.user_type,
      plan: user.plan,
      guestId: user.guest_id || null,
      ipAddress: user.ip_address || '127.0.0.1',
      userAgent: user.user_agent || 'UserService',
    };

    return this.rateLimitService.getFormattedFeatureUsage(userContext);
  }
}
