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
  SubscriptionPlan,
  UserSubscription,
  PaymentHistory,
} from './entities';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST'),
        port: configService.get<number>('DATABASE_PORT'),
        username: configService.get<string>('DATABASE_USERNAME'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        database: configService.get<string>('DATABASE_NAME'),
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
          SubscriptionPlan,
          UserSubscription,
          PaymentHistory,
        ],
        synchronize: false, // Disabled to use migrations instead
        logging: process.env.NODE_ENV !== 'production',
        migrations: [__dirname + '/migrations/*.ts'],
        migrationsTableName: 'migrations',
        migrationsRun: false, // Set to true if you want to run migrations automatically
      }),
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}
