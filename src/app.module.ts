import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from './database/database.module';
import { validationSchema } from './config/validation.schema';
import { AuthModule } from './modules/auth/auth.module';
import { ResumeTailoringModule } from './modules/resume-tailoring/resume-tailoring.module';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/jwt.guard';
import { SharedModule } from './shared/shared.module';
import { AtsMatchModule } from './modules/ats-match/ats-match.module';
import { UserModule } from './modules/user/user.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { JobApplicationModule } from './modules/job-application/job-application.module';
import { QueueModule } from './modules/queue/queue.module';

import { RateLimitGuard } from './modules/rate-limit/rate-limit.guard';
import { UserContextMiddleware } from './shared/middlewares/user-context.middleware';
import { HealthModule } from './health/health.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath:
        process.env.NODE_ENV === 'production'
          ? 'src/config/.env.prod'
          : 'src/config/.env.dev',
      validationSchema,
    }),
    // Configure Bull globally with Redis
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          password: configService.get<string>('REDIS_PASSWORD'),
          db: configService.get<number>('REDIS_DB', 0),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
    AuthModule,
    ResumeTailoringModule,
    SharedModule,
    AtsMatchModule,
    UserModule,
    RateLimitModule,
    JobApplicationModule,
    QueueModule,
    HealthModule,
    SubscriptionModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    Reflector,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(UserContextMiddleware).forRoutes('*'); // Apply middleware globally
  }
}
