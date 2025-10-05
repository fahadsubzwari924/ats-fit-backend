import { Injectable, Logger } from '@nestjs/common';
import { 
  IPaymentGateway, 
  CreateCheckoutRequest, 
  CheckoutResponse,
  SubscriptionInfo,
  CustomerPortalRequest,
  CustomerPortalResponse,
  CancelSubscriptionRequest,
  CancelSubscriptionResponse
} from '../interfaces/payment-gateway.interface';
import { LemonSqueezyService } from '../services/lemon_squeezy.service';

@Injectable()
export class LemonSqueezyPaymentGateway implements IPaymentGateway {
  private readonly logger = new Logger(LemonSqueezyPaymentGateway.name);

  constructor(private readonly lemonSqueezyService: LemonSqueezyService) {}

  getProviderName(): string {
    return 'LemonSqueezy';
  }

  async createCheckout(request: CreateCheckoutRequest) { //Promise<CheckoutResponse> {
    try {
      this.logger.log(`Creating checkout with LemonSqueezy for variant: ${request.variantId}`);

      const checkoutData = await this.lemonSqueezyService.createCheckoutSession(request);

      return checkoutData;
    } catch (error) {
      this.logger.error('Failed to create LemonSqueezy checkout', error);
      throw new Error(`LemonSqueezy checkout creation failed: ${error.message}`);
    }
  }

  async getSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
    try {
      const subscription = await this.lemonSqueezyService.getSubscriptionDetails(subscriptionId);
      
      return this.mapLemonSqueezySubscription(subscription);
    } catch (error) {
      this.logger.error(`Failed to get LemonSqueezy subscription: ${subscriptionId}`, error);
      throw new Error(`Failed to retrieve subscription: ${error.message}`);
    }
  }

  async cancelSubscription(request: CancelSubscriptionRequest): Promise<CancelSubscriptionResponse> {
    try {
      const result = await this.lemonSqueezyService.cancelSubscription(request.subscriptionId);
      
      return {
        subscriptionId: request.subscriptionId,
        status: 'cancelled',
        cancelledAt: new Date(),
        endsAt: result.ends_at ? new Date(result.ends_at) : undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to cancel LemonSqueezy subscription: ${request.subscriptionId}`, error);
      throw new Error(`Failed to cancel subscription: ${error.message}`);
    }
  }

  async createCustomerPortal(request: CustomerPortalRequest): Promise<CustomerPortalResponse> {
    try {
      const portalUrl = await this.lemonSqueezyService.getCustomerPortalUrl(request.customerId);
      
      return {
        portalUrl: portalUrl || '',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };
    } catch (error) {
      this.logger.error(`Failed to create LemonSqueezy customer portal: ${request.customerId}`, error);
      throw new Error(`Failed to create customer portal: ${error.message}`);
    }
  }

  async getCustomerSubscriptions(customerId: string): Promise<SubscriptionInfo[]> {
    try {
      // LemonSqueezy doesn't have a direct method for this, so return empty array
      // This would need to be implemented based on your specific requirements
      this.logger.warn(`LemonSqueezy getCustomerSubscriptions not implemented for: ${customerId}`);
      return [];
    } catch (error) {
      this.logger.error(`Failed to get LemonSqueezy customer subscriptions: ${customerId}`, error);
      throw new Error(`Failed to retrieve customer subscriptions: ${error.message}`);
    }
  }

  verifyWebhookSignature(signature: string, payload: string): boolean {
    try {
      // LemonSqueezy doesn't have this method in the current service, so return true for now
      // This should be implemented based on LemonSqueezy's webhook signature verification
      this.logger.warn('LemonSqueezy webhook signature verification not implemented');
      return true;
    } catch (error) {
      this.logger.error('Failed to verify LemonSqueezy webhook signature', error);
      return false;
    }
  }

  /**
   * Map LemonSqueezy subscription to our standard format
   */
  private mapLemonSqueezySubscription(lsSubscription: any): SubscriptionInfo {
    const attributes = lsSubscription.data?.attributes || lsSubscription;
    
    return {
      id: lsSubscription.data?.id || lsSubscription.id,
      status: this.mapLemonSqueezyStatus(attributes.status),
      planId: attributes.variant_id?.toString(),
      customerId: attributes.customer_id?.toString(),
      amount: attributes.unit_price ? attributes.unit_price / 100 : 0, // Convert cents to dollars
      currency: attributes.currency || 'USD',
      currentPeriodStart: new Date(attributes.created_at),
      currentPeriodEnd: new Date(attributes.renews_at || attributes.ends_at),
      cancelAtPeriodEnd: attributes.cancelled || false,
      trialEnd: attributes.trial_ends_at ? new Date(attributes.trial_ends_at) : undefined,
    };
  }

  /**
   * Map LemonSqueezy status to our standard status
   */
  private mapLemonSqueezyStatus(lsStatus: string): SubscriptionInfo['status'] {
    const statusMap: Record<string, SubscriptionInfo['status']> = {
      'active': 'active',
      'cancelled': 'cancelled',
      'expired': 'expired',
      'on_trial': 'active',
      'paused': 'paused',
      'past_due': 'past_due',
      'unpaid': 'past_due',
    };

    return statusMap[lsStatus] || 'active';
  }
}