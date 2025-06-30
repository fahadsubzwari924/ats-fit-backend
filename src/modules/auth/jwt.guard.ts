import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { User } from '../../database/entities/user.entity';
import { UnauthorizedException } from '../../shared/exceptions/custom-http-exceptions';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context) as boolean | Promise<boolean>;
  }

  handleRequest<TUser = User>(err: Error, user: TUser): TUser {
    if (err || !user) {
      throw (
        err || new UnauthorizedException('Unauthorized to make this request')
      );
    }
    return user;
  }
}
