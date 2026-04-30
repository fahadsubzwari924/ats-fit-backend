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

/**
 * Per-user sliding-window rate limit for POST /beta/redeem.
 *
 * Limits: 5 attempts per userId per 10-minute window.
 * State is in-process memory — sufficient because:
 *   1. The user is already authenticated (JWT guard runs first).
 *   2. The redeem operation itself has a pessimistic DB lock; the window
 *      only needs to prevent automated code cycling by a single account.
 * For a multi-instance deployment, swap the Map for a Redis INCR+EXPIRE.
 */

interface WindowEntry {
  count: number;
  windowStart: number;
}

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

@Injectable()
export class RedeemThrottleGuard implements CanActivate {
  private readonly logger = new Logger(RedeemThrottleGuard.name);
  private readonly windows = new Map<string, WindowEntry>();

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithUserContext>();
    const userId = request.userContext?.userId;

    if (!userId) {
      // JwtAuthGuard runs before this guard and will have rejected the request
      // before we reach here; this is a belt-and-suspenders fallback.
      return false;
    }

    const now = Date.now();
    const entry = this.windows.get(userId);

    if (!entry || now - entry.windowStart >= WINDOW_MS) {
      // Start a new window
      this.windows.set(userId, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= MAX_ATTEMPTS) {
      const retryAfterSec = Math.ceil(
        (WINDOW_MS - (now - entry.windowStart)) / 1000,
      );
      this.logger.warn(
        `Redeem throttle exceeded for userId=${userId}, retryAfterSec=${retryAfterSec}`,
      );
      throw new HttpException(BETA_ERRORS.RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }

    entry.count += 1;
    return true;
  }
}
