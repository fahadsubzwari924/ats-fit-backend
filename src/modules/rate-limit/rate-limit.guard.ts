import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { RateLimitService } from './rate-limit.service';
import { UserService } from '../user/user.service';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { RequestUser } from '../../shared/interfaces/request-user.interface';
import { UserContext } from '../auth/types/user-context.type';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { ForbiddenException } from '../../shared/exceptions/custom-http-exceptions';

export const RATE_LIMIT_FEATURE_KEY = 'rateLimitFeature';

export const RateLimitFeature = (feature: FeatureType) =>
  SetMetadata(RATE_LIMIT_FEATURE_KEY, feature);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
    private readonly userService: UserService,
    private readonly jwtGuard: JwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const feature = this.getFeature(context);

    if (!feature) return true;

    // Build user context using multi-factor logic
    const userContext = await this.buildUserContext(context, request);

    await this.enforceRateLimit(userContext, feature, request);

    return true;
  }

  private getFeature(context: ExecutionContext): FeatureType | undefined {
    return this.reflector.get<FeatureType>(
      RATE_LIMIT_FEATURE_KEY,
      context.getHandler(),
    );
  }

  private isPublicEndpoint(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  }

  /**
   * Multi-factor user context builder:
   * - If JWT is present and valid, fetch user from DB and check status.
   * - If not, create/track guest user by guestId, IP, and user-agent.
   */
  private async buildUserContext(
    context: ExecutionContext,
    request: Request,
  ): Promise<UserContext> {
    const authHeader = request.headers['authorization'];
    let userContext: UserContext | null = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      // Try to validate JWT and fetch user
      const jwtValid = await this.jwtGuard.canActivate(context);
      const user = request.user as RequestUser | undefined;

      if (jwtValid && user?.userId) {
        // Fetch user from DB and check status
        userContext = await this.userService.getAuthenticatedUserContext(
          user.userId,
        );

        if (!userContext || !userContext.isActive) {
          throw new ForbiddenException(
            'User is inactive or not found',
            ERROR_CODES.USER_NOT_FOUND,
          );
        }

        // Attach IP and user-agent for tracking
        userContext.ipAddress = request.ip;
        userContext.userAgent = request.headers['user-agent'] || '';

        // Update session info
        await this.userService.updateUserSessionInfo(
          user.userId,
          userContext.ipAddress,
          userContext.userAgent,
        );
        return userContext;
      }
      // If JWT invalid or user not found, treat as guest
      this.logger.warn('JWT invalid or user not found, treating as guest user');
    }

    // Guest user context (no valid JWT)
    userContext = await this.userService.getOrCreateGuestUser(request);

    // Attach IP and user-agent for tracking
    userContext.ipAddress = request.ip;
    userContext.userAgent = request.headers['user-agent'] || '';

    return userContext;
  }

  /**
   * Enforce rate limiting based on user context and feature.
   */
  private async enforceRateLimit(
    userContext: UserContext,
    feature: FeatureType,
    request: Request,
  ): Promise<void> {
    const rateLimitResult = await this.rateLimitService.checkRateLimit(
      userContext,
      feature,
    );

    if (!rateLimitResult.allowed) {
      this.logger.warn(
        `Rate limit exceeded for ${feature}: ${userContext.userType} user, usage: ${rateLimitResult.currentUsage}/${rateLimitResult.limit}`,
      );

      throw new ForbiddenException(
        `Rate limit exceeded for ${feature}`,
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
        undefined,
        {
          currentUsage: rateLimitResult.currentUsage,
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
          resetDate: rateLimitResult.resetDate,
          feature,
          userType: userContext.userType,
          plan: userContext.plan,
        },
      );
    }

    // Store user context and rate limit result in request for downstream use
    request['userContext'] = userContext;
    request['rateLimitResult'] = rateLimitResult;
  }
}
