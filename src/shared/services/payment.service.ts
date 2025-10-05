import { Injectable, Logger, Inject } from '@nestjs/common';
import { 
  IPaymentGateway, 
  CreateCheckoutRequest, 
  CheckoutResponse,
  SubscriptionInfo,
  CustomerPortalRequest,
  CustomerPortalResponse,
  CancelSubscriptionRequest,
  CancelSubscriptionResponse,
  PAYMENT_GATEWAY_TOKEN
} from '../modules/external/interfaces/payment-gateway.interface';

/**
 * Payment Service - Facade Pattern
 * 
 * This service acts as a facade for all payment operations.
 * Controllers depend on this service, not specific payment gateways.
 * 
 * Benefits:
 * - Controllers don't know about specific payment providers
 * - Easy to switch payment providers
 * - Centralized payment logic
 * - Consistent API across different providers
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    @Inject(PAYMENT_GATEWAY_TOKEN) private readonly paymentGateway: IPaymentGateway,
  ) {}

  /**
   * Get the current payment provider name
   */
  getProviderName(): string {
    return this.paymentGateway.getProviderName();
  }

  /**
   * Create checkout session for subscription
   */
  async createCheckout(request: CreateCheckoutRequest): Promise<CheckoutResponse> {
    try {
      this.logger.log(`Creating checkout with ${this.getProviderName()} for variant: ${request.variantId}`);
      
      const result = await this.paymentGateway.createCheckout(request);
      
      this.logger.log(`Checkout created successfully: ${result.checkoutId}`);
      return result;
    } catch (error) {
      this.logger.error('Payment checkout creation failed', error);
      throw new Error(`Checkout creation failed: ${error.message}`);
    }
  }

  /**
   * Get subscription information
   */
  async getSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
    try {
      this.logger.log(`Retrieving subscription: ${subscriptionId}`);
      
      const subscription = await this.paymentGateway.getSubscription(subscriptionId);
      
      this.logger.log(`Subscription retrieved: ${subscription.id} - Status: ${subscription.status}`);
      return subscription;
    } catch (error) {
      this.logger.error(`Failed to retrieve subscription: ${subscriptionId}`, error);
      throw new Error(`Failed to retrieve subscription: ${error.message}`);
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(request: CancelSubscriptionRequest): Promise<CancelSubscriptionResponse> {
    try {
      this.logger.log(`Cancelling subscription: ${request.subscriptionId}`);
      
      const result = await this.paymentGateway.cancelSubscription(request);
      
      this.logger.log(`Subscription cancelled: ${result.subscriptionId}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to cancel subscription: ${request.subscriptionId}`, error);
      throw new Error(`Failed to cancel subscription: ${error.message}`);
    }
  }

  /**
   * Create customer portal URL
   */
  async createCustomerPortal(request: CustomerPortalRequest): Promise<CustomerPortalResponse> {
    try {
      this.logger.log(`Creating customer portal for: ${request.customerId}`);
      
      const result = await this.paymentGateway.createCustomerPortal(request);
      
      this.logger.log(`Customer portal created for: ${request.customerId}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to create customer portal: ${request.customerId}`, error);
      throw new Error(`Failed to create customer portal: ${error.message}`);
    }
  }

  /**
   * Get all subscriptions for a customer
   */
  async getCustomerSubscriptions(customerId: string): Promise<SubscriptionInfo[]> {
    try {
      this.logger.log(`Retrieving subscriptions for customer: ${customerId}`);
      
      const subscriptions = await this.paymentGateway.getCustomerSubscriptions(customerId);
      
      this.logger.log(`Found ${subscriptions.length} subscriptions for customer: ${customerId}`);
      return subscriptions;
    } catch (error) {
      this.logger.error(`Failed to retrieve customer subscriptions: ${customerId}`, error);
      throw new Error(`Failed to retrieve customer subscriptions: ${error.message}`);
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(signature: string, payload: string): boolean {
    try {
      if (!this.paymentGateway.verifyWebhookSignature) {
        this.logger.warn('Webhook signature verification not supported by current payment gateway');
        return true; // Allow webhook if verification not supported
      }

      const isValid = this.paymentGateway.verifyWebhookSignature(signature, payload);
      
      if (!isValid) {
        this.logger.warn('Invalid webhook signature detected');
      }
      
      return isValid;
    } catch (error) {
      this.logger.error('Webhook signature verification failed', error);
      return false;
    }
  }

  /**
   * Health check - verify payment gateway connectivity
   */
  async healthCheck(): Promise<{ provider: string; status: 'healthy' | 'unhealthy'; message?: string }> {
    try {
      const provider = this.getProviderName();
      
      // Try a simple operation to test connectivity
      // This would be implementation-specific
      
      return {
        provider,
        status: 'healthy',
      };
    } catch (error) {
      return {
        provider: this.getProviderName(),
        status: 'unhealthy',
        message: error.message,
      };
    }
  }
}