/**
 * External Payment Gateway Webhook Event Types
 *
 * This enum defines all possible webhook events that can be received from external payment gateways.
 * These events are sent when various actions occur in your payment gateway store.
 *
 * @see https://docs.lemonsqueezy.com/api/webhooks
 */
export enum ExternalPaymentGatewayEvents {
  // Affiliate Events
  AFFILIATE_ACTIVATED = 'affiliate_activated',

  // Order Events
  ORDER_CREATED = 'order_created',
  ORDER_REFUNDED = 'order_refunded',

  // Subscription Events
  SUBSCRIPTION_CREATED = 'subscription_created',
  SUBSCRIPTION_UPDATED = 'subscription_updated',
  SUBSCRIPTION_CANCELLED = 'subscription_cancelled',
  SUBSCRIPTION_RESUMED = 'subscription_resumed',
  SUBSCRIPTION_EXPIRED = 'subscription_expired',
  SUBSCRIPTION_PAUSED = 'subscription_paused',
  SUBSCRIPTION_UNPAUSED = 'subscription_unpaused',

  // Subscription Payment Events
  SUBSCRIPTION_PAYMENT_FAILED = 'subscription_payment_failed',
  SUBSCRIPTION_PAYMENT_SUCCESS = 'subscription_payment_success',
  SUBSCRIPTION_PAYMENT_RECOVERED = 'subscription_payment_recovered',
  SUBSCRIPTION_PAYMENT_REFUNDED = 'subscription_payment_refunded',

  // Subscription Plan Events
  SUBSCRIPTION_PLAN_CHANGED = 'subscription_plan_changed',

  // License Key Events
  LICENSE_KEY_CREATED = 'license_key_created',
  LICENSE_KEY_UPDATED = 'license_key_updated',
}

/**
 * Helper class to work with external payment gateway events
 */
export class ExternalPaymentGatewayEventHelper {
  /**
   * Check if an event is subscription-related
   */
  static isSubscriptionEvent(event: string): boolean {
    return event?.startsWith('subscription_') || false;
  }

  /**
   * Check if an event is payment-related
   */
  static isPaymentEvent(event: string): boolean {
    return (
      event?.includes('payment_') ||
      event === ExternalPaymentGatewayEvents.ORDER_CREATED ||
      false
    );
  }

  /**
   * Check if an event is order-related
   */
  static isOrderEvent(event: string): boolean {
    return event?.startsWith('order_') || false;
  }

  /**
   * Check if an event is license-related
   */
  static isLicenseEvent(event: string): boolean {
    return event?.startsWith('license_key_') || false;
  }

  /**
   * Check if an event should trigger subscription creation/update
   */
  static shouldCreateOrUpdateSubscription(event: string): boolean {
    const creationEvents = [
      ExternalPaymentGatewayEvents.SUBSCRIPTION_CREATED,
      ExternalPaymentGatewayEvents.SUBSCRIPTION_PAYMENT_SUCCESS,
      ExternalPaymentGatewayEvents.SUBSCRIPTION_RESUMED,
      ExternalPaymentGatewayEvents.SUBSCRIPTION_UNPAUSED,
    ];
    return creationEvents.includes(event as ExternalPaymentGatewayEvents);
  }

  /**
   * Check if an event should trigger subscription cancellation/deactivation
   */
  static shouldDeactivateSubscription(event: string): boolean {
    const deactivationEvents = [
      ExternalPaymentGatewayEvents.SUBSCRIPTION_CANCELLED,
      ExternalPaymentGatewayEvents.SUBSCRIPTION_EXPIRED,
      ExternalPaymentGatewayEvents.SUBSCRIPTION_PAUSED,
    ];
    return deactivationEvents.includes(event as ExternalPaymentGatewayEvents);
  }

  /**
   * Get all event values as array
   */
  static getAllEvents(): string[] {
    return Object.values(ExternalPaymentGatewayEvents);
  }

  /**
   * Validate if event is a known external payment gateway event
   */
  static isValidEvent(event: string): boolean {
    return Object.values(ExternalPaymentGatewayEvents).includes(
      event as ExternalPaymentGatewayEvents,
    );
  }
}
