import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { BETA_ERRORS } from '../constants/beta-error-codes';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { email?: string } }>();
    const user = request.user;
    const adminEmails = (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (!user?.email || !adminEmails.includes(user.email.toLowerCase())) {
      throw new ForbiddenException(BETA_ERRORS.FORBIDDEN_ADMIN);
    }
    return true;
  }
}
