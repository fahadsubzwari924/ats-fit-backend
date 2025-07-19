import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RateLimitService } from './rate-limit.service';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { UserContext } from '../auth/types/user-context.type';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { ForbiddenException } from '../../shared/exceptions/custom-http-exceptions';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';

export const RATE_LIMIT_FEATURE_KEY = 'rateLimitFeature';

export const RateLimitFeature = (feature: FeatureType) =>
  SetMetadata(RATE_LIMIT_FEATURE_KEY, feature);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUserContext>();
    const feature = this.getFeature(context);

    if (!feature) return true;

    const userContext = request.userContext;

    await this.enforceRateLimit(userContext, feature, request);

    return true;
  }

  private getFeature(context: ExecutionContext): FeatureType | undefined {
    return this.reflector.get<FeatureType>(
      RATE_LIMIT_FEATURE_KEY,
      context.getHandler(),
    );
  }

  /**
   * Enforce rate limiting based on user context and feature.
   */
  private async enforceRateLimit(
    userContext: UserContext,
    feature: FeatureType,
    request: RequestWithUserContext,
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
