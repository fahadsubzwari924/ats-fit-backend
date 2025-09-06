import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { BaseMapperService } from '../../shared/services/base-mapper.service';
import { JwtAuthGuard } from './jwt.guard';
import { PremiumUserGuard } from './guards/premium-user.guard';
import { User } from '../../database/entities';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User]),
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
