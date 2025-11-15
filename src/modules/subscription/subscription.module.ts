import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionController } from './controllers/subscription.controller';
import { SubscriptionService } from './services/subscription.service';
import { SubscriptionPlanService } from './services/subscription-plan.service';
import { PaymentService } from '../../shared/services/payment.service';
import { LemonSqueezyService } from './externals/services/lemon_squeezy.service';
import { LemonSqueezyPaymentGateway } from './externals/gateways/lemonsqueezy-payment.gateway';
import { PaymentGatewayFactory } from './externals/factories/payment-gateway.factory';
import { UserSubscription } from '../../database/entities/user-subscription.entity';
import { UserModule } from '../user/user.module';
import { SubscriptionPlan } from '../../database/entities/subscription-plan.entity';
import { PaymentHistory } from '../../database/entities/payment-history.entity';
import { PAYMENT_GATEWAY_TOKEN } from './externals/interfaces/payment-gateway.interface';
import { PaymentHistoryService } from './services/payment-history.service';
import { EMAIL_SERVICE_TOKEN } from '../../shared/interfaces/email.interface';
import { MailchimpTransactionalService } from '../../shared/services/mailchimp.service';
import { AwsSesService } from 'src/shared/services/aws-ses.service';


@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      UserSubscription,
      SubscriptionPlan,
      PaymentHistory,
    ]),
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
      useFactory: (factory: PaymentGatewayFactory) =>
        factory.createPaymentGateway(),
      inject: [PaymentGatewayFactory],
    },
    // Provide the email service behind a stable token so swapping providers
    // only requires changing this single registration.
    {
      provide: EMAIL_SERVICE_TOKEN,
      useClass: AwsSesService,
    },
  ],
  exports: [
    SubscriptionService,
    SubscriptionPlanService,
    PaymentService,
    PAYMENT_GATEWAY_TOKEN,
    EMAIL_SERVICE_TOKEN
  ],
})
export class SubscriptionModule {}
