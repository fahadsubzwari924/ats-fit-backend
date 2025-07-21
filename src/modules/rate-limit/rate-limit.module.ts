import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsageTracking } from '../../database/entities/usage-tracking.entity';
import { RateLimitConfig } from '../../database/entities/rate-limit-config.entity';
import { RateLimitService } from './rate-limit.service';
import { RateLimitGuard } from './rate-limit.guard';
import { UsageTrackingInterceptor } from './usage-tracking.interceptor';
import { RateLimitController } from './rate-limit.controller';
import { UserModule } from '../user/user.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UsageTracking, RateLimitConfig]),
    forwardRef(() => UserModule),
    AuthModule,
  ],
  providers: [RateLimitService, RateLimitGuard, UsageTrackingInterceptor],
  controllers: [RateLimitController],
  exports: [RateLimitService, RateLimitGuard, UsageTrackingInterceptor],
})
export class RateLimitModule {}
