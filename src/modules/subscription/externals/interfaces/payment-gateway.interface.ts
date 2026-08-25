/**
 * Abstract Payment Gateway Interface
 *
 * This interface defines the contract for all payment providers.
 * Controllers depend on this abstraction, not concrete implementations.
 */

import { PaymentProvider } from '../../enums/payment-provider.enum';
import { SubscriptionStatus } from '../../enums/subscription-status.enum';
import { NormalizedWebhookEvent } from './normalized-webhook-event.interface';

/** Subset of incoming request headers needed for signature verification. */
export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface CreateCheckoutRequest {
  variantId: string;
  userId?: string;
  name?: string;
  email?: string;
  redirectUrl?: string;
  customData?: Record<string, any>;
  /** Optional pre-filled discount/coupon code to apply at checkout (e.g. founding rate lock) */
  discountCode?: string;
}

export interface CheckoutResponse {
  checkoutUrl: string;
  checkoutId: string;
  paymentProvider: PaymentProvider;
  expiresAt?: Date;
}

export interface SubscriptionInfo {
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
}

export interface CustomerPortalRequest {
  customerId: string;
  returnUrl?: string;
}

export interface CustomerPortalResponse {
  portalUrl: string;
  expiresAt?: Date;
}

export interface CancelSubscriptionRequest {
  subscriptionId: string;
  cancelAtPeriodEnd?: boolean;
  reason?: string;
}

export interface CancelSubscriptionResponse {
  subscriptionId: string;
  status: SubscriptionStatus;
  cancelledAt: Date;
  endsAt?: Date;
}

/**
 * Payment Gateway Interface
 *
 * All payment providers (Creem, Stripe, Paddle, etc.)
 * must implement this interface.
 */
export interface IPaymentGateway {
  /**
   * Get the name of the payment provider
   */
  getProviderName(): PaymentProvider;

  /**
   * Create a checkout session/URL for subscription
   */
  createCheckout(request: CreateCheckoutRequest): Promise<CheckoutResponse>;

  /**
   * Get subscription information by ID
   */
  getSubscription(subscriptionId: string): Promise<SubscriptionInfo>;

  /**
   * Cancel a subscription
   */
  cancelSubscription(
    request: CancelSubscriptionRequest,
  ): Promise<CancelSubscriptionResponse>;

  /**
   * Create customer portal URL for managing subscription
   */
  createCustomerPortal(
    request: CustomerPortalRequest,
  ): Promise<CustomerPortalResponse>;

  /**
   * Get all subscriptions for a customer
   */
  getCustomerSubscriptions(customerId: string): Promise<SubscriptionInfo[]>;

  /**
   * Verify webhook authenticity from the request headers + raw body.
   */
  verifyWebhookSignature(headers: WebhookHeaders, rawBody: string): boolean;

  /**
   * Translate a provider webhook payload into the internal event shape.
   */
  parseWebhook(rawPayload: unknown): NormalizedWebhookEvent;
}

/**
 * Injection token for Payment Gateway
 */
export const PAYMENT_GATEWAY_TOKEN = Symbol('IPaymentGateway');
