import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { StringValue } from 'ms';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { BaseMapperService } from '../../shared/services/base-mapper.service';
import { JwtAuthGuard } from './jwt.guard';
import { PremiumUserGuard } from './guards/premium-user.guard';
import { User } from '../../database/entities';
import { BetaInvite } from '../../database/entities/beta-invite.entity';
import { PasswordResetToken } from '../../database/entities/password-reset-token.entity';
import { PasswordResetService } from './services/password-reset.service';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { UserModule } from '../user/user.module';
import { GoogleService } from '../../shared/modules/external/services/google.service';
import { BrevoService } from '../../shared/modules/external/services/brevo.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') as StringValue,
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User, BetaInvite, PasswordResetToken]),
    ConfigModule,
    forwardRef(() => RateLimitModule),
    forwardRef(() => UserModule),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    BaseMapperService,
    JwtAuthGuard,
    PremiumUserGuard,
    GoogleService,
    BrevoService,
    PasswordResetService,
  ],
  controllers: [AuthController],
  exports: [
    AuthService,
    JwtStrategy,
    PassportModule,
    JwtAuthGuard,
    PremiumUserGuard,
  ],
})
export class AuthModule {}
