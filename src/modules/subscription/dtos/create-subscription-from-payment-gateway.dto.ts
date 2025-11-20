import { ICreateSubscriptionData } from '../interfaces/subscription.interface';
import { PaymentConfirmationDto } from './payment-confirmation.dto';
import { SubscriptionStatus } from '../enums/subscription-status.enum';
import { Currency } from '../enums/payment.enum';

/**
 * DTO to transform payment gateway notification payload to subscription creation data
 * Purpose: Data transformation only, no validation
 */
export class CreateSubscriptionFromPaymentGatewayDto implements ICreateSubscriptionData {
  payment_gateway_subscription_id: string;
  subscription_plan_id: string;
  user_id: string;
  status: SubscriptionStatus;
  amount: number;
  currency: Currency;
  starts_at: Date;
  ends_at: Date;
  metadata: Record<string, any>;

  constructor(payload: PaymentConfirmationDto) {
    this.payment_gateway_subscription_id = payload?.data?.id;
    this.subscription_plan_id = payload?.meta?.custom_data?.plan_id;
    this.user_id = payload?.meta?.custom_data?.user_id;
    this.status = this.mapStatus(payload?.data?.attributes?.status);
    this.amount = payload?.data?.attributes?.total || 0;
    this.currency = (payload?.data?.attributes?.currency as Currency) || Currency.USD;
    this.starts_at = new Date(payload?.data?.attributes?.created_at || Date.now());
    this.ends_at = new Date(
      payload?.data?.attributes?.renews_at ||
        payload?.data?.attributes?.ends_at ||
        Date.now() + 30 * 24 * 60 * 60 * 1000,
    );
    this.metadata = {
      paymentGatewayData: payload?.data?.attributes,
      customData: payload?.meta?.custom_data,
    };
  }

  private mapStatus(status: string): SubscriptionStatus {
    const statusMap: Record<string, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      cancelled: SubscriptionStatus.CANCELLED,
      expired: SubscriptionStatus.EXPIRED,
      paused: SubscriptionStatus.PAUSED,
      past_due: SubscriptionStatus.PAST_DUE,
      on_trial: SubscriptionStatus.ACTIVE,
      unpaid: SubscriptionStatus.PAST_DUE,
    };

    return statusMap[status?.toLowerCase()] || SubscriptionStatus.ACTIVE;
  }
}
