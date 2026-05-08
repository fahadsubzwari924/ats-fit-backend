import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from './entities/user.entity';
import {
  ResumeGeneration,
  ResumeTemplate,
  UsageTracking,
  RateLimitConfig,
  AtsMatchHistory,
  Resume,
  JobApplication,
  QueueMessage,
  ExtractedResumeContent,
  ResumeGenerationResult,
  SubscriptionPlan,
  UserSubscription,
  PaymentHistory,
  TailoringQuestion,
  EnrichedResumeProfile,
  PasswordResetToken,
  BetaInvite,
  BatchTailoringRun,
  BatchTailoringJob,
  ResumeReplacementAudit,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const dbUrl = configService.get<string>('DATABASE_URL');
        const connectionConfig = dbUrl
          ? { url: dbUrl }
          : {
              host: configService.get<string>('DATABASE_HOST'),
              port: configService.get<number>('DATABASE_PORT'),
              username: configService.get<string>('DATABASE_USERNAME'),
              password: configService.get<string>('DATABASE_PASSWORD'),
              database: configService.get<string>('DATABASE_NAME'),
            };
        return {
          type: 'postgres' as const,
          ...connectionConfig,
          entities: [
            User,
            ResumeGeneration,
            ResumeTemplate,
            UsageTracking,
            RateLimitConfig,
            AtsMatchHistory,
            Resume,
            JobApplication,
            QueueMessage,
            ExtractedResumeContent,
            ResumeGenerationResult,
            SubscriptionPlan,
            UserSubscription,
            PaymentHistory,
            TailoringQuestion,
            EnrichedResumeProfile,
            PasswordResetToken,
            BetaInvite,
            BatchTailoringRun,
            BatchTailoringJob,
            ResumeReplacementAudit,
          ],
          synchronize: false,
          logging: process.env.NODE_ENV !== 'production',
          migrations: [__dirname + '/migrations/*.ts'],
          migrationsTableName: 'migrations',
          migrationsRun: false,
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
