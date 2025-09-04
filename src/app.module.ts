import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { validationSchema } from './config/validation.schema';
import { AuthModule } from './modules/auth/auth.module';
import { ResumeModule } from './modules/resume/resume.module';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/jwt.guard';
import { SharedModule } from './shared/shared.module';
import { AtsMatchModule } from './modules/ats-match/ats-match.module';
import { UserModule } from './modules/user/user.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { JobApplicationModule } from './modules/job-application/job-application.module';
import { RateLimitGuard } from './modules/rate-limit/rate-limit.guard';
import { UserContextMiddleware } from './shared/middlewares/user-context.middleware';
import { HealthModule } from './health/health.module';

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
    DatabaseModule,
    AuthModule,
    ResumeModule,
    SharedModule,
    AtsMatchModule,
    UserModule,
    RateLimitModule,
    JobApplicationModule,
    HealthModule,
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
