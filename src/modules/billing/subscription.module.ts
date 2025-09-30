import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionController } from './controllers/subscription.controller';
import { LemonSqueezyService } from '../../shared/modules/external/services/lemon_squeezy.service';
import { SubscriptionService } from '../subscription/services/subscription.service';
import { Subscription } from '../subscription/entities/subscription.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Subscription]),
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, LemonSqueezyService],
  exports: [SubscriptionService, LemonSqueezyService],
})
export class SubscriptionModule {}