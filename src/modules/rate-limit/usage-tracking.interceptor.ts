import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { RateLimitService } from './rate-limit.service';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
import { RATE_LIMIT_FEATURE_KEY } from './rate-limit.guard';
import { RequestWithUserContext } from '../../shared/interfaces/request-user.interface';

@Injectable()
export class UsageTrackingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UsageTrackingInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimitService: RateLimitService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithUserContext>();
    const feature = this.reflector.get<FeatureType>(
      RATE_LIMIT_FEATURE_KEY,
      context.getHandler(),
    );

    if (!feature) {
      return next.handle(); // No usage tracking required
    }

    return next.handle().pipe(
      tap({
        next: () => {
          // Only record usage on successful responses
          try {
            const userContext = request.userContext;
            if (userContext) {
              this.rateLimitService
                .recordUsage(userContext, feature)
                .catch((error) => {
                  this.logger.error(
                    `Failed to record usage for ${feature}:`,
                    error,
                  );
                });
              this.logger.log(
                `Usage recorded for ${feature}: ${userContext.userType} user`,
              );
            }
          } catch (error) {
            this.logger.error(`Failed to record usage for ${feature}:`, error);
            // Don't throw error to avoid breaking the response
          }
        },
        error: (error: Error) => {
          // Don't record usage on errors
          this.logger.debug(
            `Not recording usage for ${feature} due to error: ${error.message ?? 'Unknown error'}`,
          );
        },
      }),
    );
  }
}
