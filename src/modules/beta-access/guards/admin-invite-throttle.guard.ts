import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import { BETA_ERRORS } from '../constants/beta-error-codes';

interface WindowEntry {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_ATTEMPTS = 10;

@Injectable()
export class AdminInviteThrottleGuard implements CanActivate {
  private readonly logger = new Logger(AdminInviteThrottleGuard.name);
  private readonly windows = new Map<string, WindowEntry>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUserContext>();
    const userId = request.userContext?.userId;

    if (!userId) {
      return false;
    }

    const now = Date.now();
    const entry = this.windows.get(userId);

    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      this.windows.set(userId, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= MAX_ATTEMPTS) {
      const retryAfterSec = Math.ceil(
        (WINDOW_MS - (now - entry.windowStart)) / 1000,
      );
      this.logger.warn(
        `Admin invite throttle exceeded for userId=${userId}, retryAfterSec=${retryAfterSec}`,
      );
      throw new HttpException(
        BETA_ERRORS.RATE_LIMITED,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    entry.count += 1;
    return true;
  }
}
