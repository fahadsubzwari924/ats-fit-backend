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
import { LemonSqueezySubscription } from '../models/lemonsqueezy-subscription.model';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '../../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../../shared/constants/error-codes';

@Injectable()
export class LemonSqueezyPaymentGateway implements IPaymentGateway {
  private readonly logger = new Logger(LemonSqueezyPaymentGateway.name);

  constructor(private readonly lemonSqueezyService: LemonSqueezyService) {}

  getProviderName(): string {
    return 'LemonSqueezy';
  }

  async createCheckout(request: CreateCheckoutRequest): Promise<CheckoutResponse> {
    try {
      this.logger.log(`Creating checkout with LemonSqueezy for variant: ${request.variantId}`);

      const checkoutData = await this.lemonSqueezyService.createCheckoutSession(request);

      return {
        checkoutUrl: checkoutData.data.data.attributes.url,
        checkoutId: checkoutData.data.data.id,
        paymentProvider: 'LemonSqueezy',
      };
    } catch (error) {
      this.logger.error('Failed to create LemonSqueezy checkout', error);
      throw new BadRequestException(
        `LemonSqueezy checkout creation failed: ${error.message}`,
        ERROR_CODES.CHECKOUT_SESSION_CREATION_FAILED
      );
    }
  }

  async getSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
    try {
      const subscription = await this.lemonSqueezyService.getSubscriptionDetails(subscriptionId);
      
      return new LemonSqueezySubscription(subscription);
    } catch (error) {
      this.logger.error(`Failed to get LemonSqueezy subscription: ${subscriptionId}`, error);
      throw new NotFoundException(
        `Failed to retrieve subscription: ${error.message}`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND
      );
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
      throw new BadRequestException(
        `Failed to cancel subscription: ${error.message}`,
        ERROR_CODES.FAILED_TO_CANCEL_SUBSCRIPTION
      );
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
      throw new BadRequestException(
        `Failed to create customer portal: ${error.message}`,
        ERROR_CODES.CUSTOMER_PORTAL_URL_CREATION_FAILED
      );
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
      throw new InternalServerErrorException(
        `Failed to retrieve customer subscriptions: ${error.message}`,
        ERROR_CODES.INTERNAL_SERVER
      );
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
}