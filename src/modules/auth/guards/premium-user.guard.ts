import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { ForbiddenException } from '../../../shared/exceptions/custom-http-exceptions';

@Injectable()
export class PremiumUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUserContext>();
    const userContext = request.userContext;

    if (!userContext || !userContext.userId) {
      throw new ForbiddenException(
        'Authentication required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    if (!userContext.isPremium) {
      throw new ForbiddenException(
        'Premium subscription required to upload resumes',
        ERROR_CODES.PREMIUM_REQUIRED,
      );
    }

    return true;
  }
}
