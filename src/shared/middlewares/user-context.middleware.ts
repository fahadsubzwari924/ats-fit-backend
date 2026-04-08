import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { UserService } from '../../modules/user/user.service';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { UserContext } from '../../modules/auth/types/user-context.type';
import { shouldSkipUserContext } from '../constants/middleware-config';

@Injectable()
export class UserContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(UserContextMiddleware.name);

  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const fullPath = req.originalUrl || req.url;
    this.logger.debug(
      'Checking path:',
      fullPath,
      'baseUrl:',
      req.baseUrl,
      'path:',
      req.path,
    );

    if (shouldSkipUserContext(req)) {
      this.logger.log('Skipping user context middleware for path:', fullPath);
      return next();
    }

    const authHeader = req.headers['authorization'];
    let userContext: UserContext | null = null;

    try {
      if (authHeader?.startsWith('Bearer ')) {
        userContext = await this.buildAuthenticatedContext(
          req,
          authHeader.split(' ')[1],
        );
      }

      if (userContext) {
        userContext.ipAddress = req.ip;
        userContext.userAgent = req.headers['user-agent'] || '';
      }

      req['userContext'] = userContext;
      next();
    } catch (error) {
      this.logger.error('Failed to build user context:', error);

      if (shouldSkipUserContext(req)) {
        this.logger.warn(
          'User context failed for skip-auth path, continuing without context',
          { path: req.path },
        );
        return next();
      }

      next(error);
    }
  }

  /**
   * Attempts to build an authenticated UserContext from a Bearer token.
   *
   * Separation of concerns:
   * - JWT verification errors (invalid signature, expired, malformed) are caught
   *   here and result in null — unauthenticated requests have no userContext.
   * - Application errors (user not found, inactive account) are thrown so the
   *   outer handler can respond with the appropriate HTTP error.
   * - Session update is fire-and-forget; a DB hiccup must never block a valid
   *   authenticated request.
   *
   * Returns null when the token cannot be verified (unauthenticated request).
   */
  private async buildAuthenticatedContext(
    req: Request,
    token: string,
  ): Promise<UserContext | null> {
    const secret =
      this.configService.get<string>('JWT_SECRET') || process.env.JWT_SECRET;

    let payload: { sub?: string };
    try {
      payload = jwt.verify(token, secret) as { sub?: string };
    } catch (jwtError) {
      const reason =
        jwtError instanceof jwt.TokenExpiredError
          ? 'expired'
          : jwtError instanceof jwt.JsonWebTokenError
            ? 'invalid'
            : 'verification failed';
      this.logger.warn(`JWT ${reason}, no user context`, {
        reason: (jwtError as Error).message,
      });
      return null;
    }

    if (!payload?.sub) {
      this.logger.warn('JWT verified but missing sub claim, no user context');
      return null;
    }

    // getAuthenticatedUserContext queries with is_active: true and throws
    // NotFoundException if the user does not exist or is inactive — no
    // redundant isActive check is needed here.
    const userContext = await this.userService.getAuthenticatedUserContext(
      payload.sub,
    );

    userContext.ipAddress = req.ip;
    userContext.userAgent = req.headers['user-agent'] || '';

    // Fire-and-forget: a session update failure is non-critical and must not
    // interrupt an otherwise valid authenticated request.
    this.userService
      .updateUserSessionInfo(
        payload.sub,
        userContext.ipAddress,
        userContext.userAgent,
      )
      .catch((err: Error) =>
        this.logger.warn('Failed to update user session info (non-critical)', {
          userId: payload.sub,
          error: err?.message,
        }),
      );

    return userContext;
  }
}
