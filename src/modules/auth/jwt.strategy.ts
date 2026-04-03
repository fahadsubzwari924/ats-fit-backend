import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity';
import { JwtPayload } from '../../shared/interfaces/jwt-payload.interface';
import { UnauthorizedException } from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';

/** Cache TTL (ms): DB is queried at most once per 30 s per user. */
const USER_CACHE_TTL_MS = 30_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  /**
   * Called by Passport after the JWT signature is verified.
   * Confirms the user still exists and is active in the database.
   * A lightweight, cached query is used so this adds negligible overhead.
   */
  async validate(payload: JwtPayload): Promise<{ userId: string; email: string }> {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub, is_active: true },
      select: ['id', 'email', 'is_active'],
      cache: { id: `jwt_user_${payload.sub}`, milliseconds: USER_CACHE_TTL_MS },
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
