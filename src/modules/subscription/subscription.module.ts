import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionController } from './controllers/subscription.controller';
import { SubscriptionService } from './services/subscription.service';
import { SubscriptionPlanService } from './services/subscription-plan.service';
import { PaymentService } from '../../shared/services/payment.service';
import { LemonSqueezyService } from '../../shared/modules/external/services/lemon_squeezy.service';
import { LemonSqueezyPaymentGateway } from '../../shared/modules/external/gateways/lemonsqueezy-payment.gateway';
import { PaymentGatewayFactory } from '../../shared/modules/external/factories/payment-gateway.factory';
import { UserSubscription } from '../../database/entities/user-subscription.entity';
import { UserModule } from '../user/user.module';
import { SubscriptionPlan } from '../../database/entities/subscription-plan.entity';
import { PaymentHistory } from '../../database/entities/payment-history.entity';
import { PAYMENT_GATEWAY_TOKEN } from '../../shared/modules/external/interfaces/payment-gateway.interface';
import { PaymentHistoryService } from './services/payment-history.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([UserSubscription, SubscriptionPlan, PaymentHistory]),
    UserModule, // Import UserModule to access UserService
  ],
  controllers: [SubscriptionController],
  providers: [
    // Core Services
    SubscriptionService,
    SubscriptionPlanService,
    
    // Payment Services
    PaymentService,
    PaymentHistoryService,
    PaymentGatewayFactory,
    
    // Payment Gateway Implementations
    LemonSqueezyService,
    LemonSqueezyPaymentGateway,
    
    // Factory Provider for Payment Gateway
    {
      provide: PAYMENT_GATEWAY_TOKEN,
      useFactory: (factory: PaymentGatewayFactory) => factory.createPaymentGateway(),
      inject: [PaymentGatewayFactory],
    },
  ],
  exports: [
    SubscriptionService, 
    SubscriptionPlanService, 
    PaymentService,
    PAYMENT_GATEWAY_TOKEN,
  ],
})
export class SubscriptionModule {}