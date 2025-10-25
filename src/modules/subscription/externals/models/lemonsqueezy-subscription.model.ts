import { SubscriptionInfo } from '../interfaces/payment-gateway.interface';

export class LemonSqueezySubscription implements SubscriptionInfo {
  id: string;
  status: SubscriptionInfo['status'];
  planId: string;
  customerId: string;
  amount: number;
  currency: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEnd?: Date;

  constructor(lemonSqueezyResponse: any) {
    const attributes = lemonSqueezyResponse.data?.attributes || lemonSqueezyResponse;
    
    const statusMap: Record<string, SubscriptionInfo['status']> = {
      'active': 'active',
      'cancelled': 'cancelled',
      'expired': 'expired',
      'on_trial': 'active',
      'paused': 'paused',
      'past_due': 'past_due',
      'unpaid': 'past_due',
    };
    
    this.id = lemonSqueezyResponse.data?.id;
    this.status = lemonSqueezyResponse?.data?.attributes;
    this.planId = attributes.variant_id?.toString() || '';
    this.customerId = attributes.customer_id?.toString() || '';
    this.amount = attributes.unit_price ? attributes.unit_price / 100 : 0;
    this.currency = attributes.currency || 'USD';
    this.currentPeriodStart = new Date(attributes.created_at);
    this.currentPeriodEnd = new Date(attributes.renews_at || attributes.ends_at);
    this.cancelAtPeriodEnd = attributes.cancelled || false;
    this.trialEnd = attributes.trial_ends_at ? new Date(attributes.trial_ends_at) : undefined;
  }
}