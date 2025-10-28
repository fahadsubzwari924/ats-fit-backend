import { SubscriptionInfo } from '../interfaces/payment-gateway.interface';
import { Currency } from '../../enums/payment.enum';
import { SubscriptionStatus } from '../../enums/subscription-status.enum';

export class LemonSqueezySubscription implements SubscriptionInfo {
  id: string;
  status: SubscriptionStatus;
  planId: string;
  customerId: string;
  amount: number;
  currency: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEnd?: Date;

  constructor(lemonSqueezyResponse: any) {
    const attributes =
      lemonSqueezyResponse.data?.attributes || lemonSqueezyResponse;

    const statusMap: Record<string, SubscriptionStatus> = {
      active: SubscriptionStatus.ACTIVE,
      cancelled: SubscriptionStatus.CANCELLED,
      expired: SubscriptionStatus.EXPIRED,
      on_trial: SubscriptionStatus.ACTIVE,
      paused: SubscriptionStatus.PAUSED,
      past_due: SubscriptionStatus.PAST_DUE,
      unpaid: SubscriptionStatus.PAST_DUE,
    };

    this.id = lemonSqueezyResponse.data?.id;
    this.status = statusMap[attributes.status] || SubscriptionStatus.ACTIVE;
    this.planId = attributes.variant_id?.toString() || '';
    this.customerId = attributes.customer_id?.toString() || '';
    this.amount = attributes.unit_price ? attributes.unit_price / 100 : 0;
    this.currency = attributes.currency || Currency.USD;
    this.currentPeriodStart = new Date(attributes.created_at);
    this.currentPeriodEnd = new Date(
      attributes.renews_at || attributes.ends_at,
    );
    this.cancelAtPeriodEnd = attributes.cancelled || false;
    this.trialEnd = attributes.trial_ends_at
      ? new Date(attributes.trial_ends_at)
      : undefined;
  }
}
