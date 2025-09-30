import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionController } from './controllers/subscription.controller';
import { SubscriptionService } from './services/subscription.service';
import { SubscriptionPlanService } from './services/subscription-plan.service';
import { LemonSqueezyService } from '../../shared/modules/external/services/lemon_squeezy.service';
import { Subscription } from './entities/subscription.entity';
import { SubscriptionPlan } from './entities/subscription-plan.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Subscription, SubscriptionPlan]),
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SubscriptionPlanService, LemonSqueezyService],
  exports: [SubscriptionService, SubscriptionPlanService, LemonSqueezyService],
})
export class SubscriptionModule {}