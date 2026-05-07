import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { JwtPayload } from '../../shared/interfaces/jwt-payload.interface';
import { UnauthorizedException } from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';

/**
 * Paths allowed to authenticate via `?access_token=` query parameter.
 *
 * URL-based tokens leak into access logs, `Referer` headers, browser history,
 * and APM tools, so they are restricted to Server-Sent Events (SSE) endpoints
 * where the EventSource browser API cannot send custom Authorization headers.
 * All other endpoints must use the `Authorization: Bearer` header.
 */
const ssePaths = [/\/batch\/v2\/[^/]+\/events$/];

const ssePathExtractor = (req: Request): string | null => {
  if (!req?.url) return null;
  const matchesSse = ssePaths.some((re) => re.test(req.url.split('?')[0]));
  if (!matchesSse) return null;
  const token = (req.query as { access_token?: string } | undefined)
    ?.access_token;
  return typeof token === 'string' ? token : null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ssePathExtractor,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Called by Passport after the JWT signature is verified.
   * Confirms the user still exists and is active in the database.
   * Uses a direct indexed primary-key lookup so deletion/deactivation takes
   * effect on the very next request with no cache lag.
   */
  async validate(
    payload: JwtPayload,
  ): Promise<{ userId: string; email: string }> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub, is_active: true },
      select: ['id', 'email', 'is_active'],
    });

    if (!user) {
      throw new UnauthorizedException(
        'Session is no longer valid. Please sign in again.',
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    return { userId: user.id, email: user.email };
  }
}
