import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { UserService } from '../../modules/user/user.service';
import * as jwt from 'jsonwebtoken';
import { ConfigService } from '@nestjs/config';
import { UserContext } from '../../modules/auth/types/user-context.type';
import { ForbiddenException } from '../exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../constants/error-codes';

@Injectable()
export class UserContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(UserContextMiddleware.name);

  constructor(
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const authHeader = req.headers['authorization'];
    let userContext: UserContext | null = null;

    try {
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
          const secret =
            this.configService.get<string>('JWT_SECRET') ||
            process.env.JWT_SECRET;
          const payload = jwt.verify(token, secret) as { sub?: string };
          if (payload && payload.sub) {
            userContext = await this.userService.getAuthenticatedUserContext(
              payload.sub,
            );
            if (!userContext || !userContext.isActive) {
              throw new ForbiddenException(
                'Invalid user context',
                ERROR_CODES.INVALID_USER_CONTEXT,
              );
            }
            userContext.ipAddress = req.ip;
            userContext.userAgent = req.headers['user-agent'] || '';
            await this.userService.updateUserSessionInfo(
              payload.sub,
              userContext.ipAddress,
              userContext.userAgent,
            );
          } else {
            this.logger.warn(
              'JWT valid but no userId (sub) found, treating as guest user',
            );
          }
        } catch {
          this.logger.warn(
            'JWT invalid or verification failed, treating as guest user',
          );
        }
      }

      if (!userContext) {
        userContext = await this.userService.getOrCreateGuestUser(req);
        userContext.ipAddress = req.ip;
        userContext.userAgent = req.headers['user-agent'] || '';
      }

      req['userContext'] = userContext;
      next();
    } catch (error) {
      this.logger.error('Failed to build user context:', error);
      next(error);
    }
  }
}
