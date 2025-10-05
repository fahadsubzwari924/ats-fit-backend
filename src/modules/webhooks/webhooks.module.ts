import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { WebhookController } from './controllers/webhook.controller';
import { WebhookService } from './services/webhook.service';
import { PaymentHistoryService } from './services/payment-history.service';
import { PaymentHistory } from './entities/payment-history.entity';
import { UserModule } from '../user/user.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([PaymentHistory]),
    UserModule, // For UserService dependency in PaymentHistoryService
    SubscriptionModule, // For SubscriptionService and SubscriptionPlanService dependencies
  ],
  controllers: [WebhookController],
  providers: [
    WebhookService,
    PaymentHistoryService,
  ],
  exports: [
    WebhookService,
    PaymentHistoryService,
  ],
})
export class WebhooksModule {}