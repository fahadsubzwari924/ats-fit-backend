/**
 * LemonSqueezy Webhook Event Types
 * 
 * This enum defines all possible webhook events that can be received from LemonSqueezy.
 * These events are sent when various actions occur in your LemonSqueezy store.
 * 
 * @see https://docs.lemonsqueezy.com/api/webhooks
 */
export enum LemonSqueezyEvent {
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
 * Helper class to work with LemonSqueezy events
 */
export class LemonSqueezyEventHelper {
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
    return event?.includes('payment_') || event === LemonSqueezyEvent.ORDER_CREATED || false;
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
      LemonSqueezyEvent.SUBSCRIPTION_CREATED,
      LemonSqueezyEvent.SUBSCRIPTION_PAYMENT_SUCCESS,
      LemonSqueezyEvent.SUBSCRIPTION_RESUMED,
      LemonSqueezyEvent.SUBSCRIPTION_UNPAUSED,
    ];
    return creationEvents.includes(event as LemonSqueezyEvent);
  }

  /**
   * Check if an event should trigger subscription cancellation/deactivation
   */
  static shouldDeactivateSubscription(event: string): boolean {
    const deactivationEvents = [
      LemonSqueezyEvent.SUBSCRIPTION_CANCELLED,
      LemonSqueezyEvent.SUBSCRIPTION_EXPIRED,
      LemonSqueezyEvent.SUBSCRIPTION_PAUSED,
    ];
    return deactivationEvents.includes(event as LemonSqueezyEvent);
  }

  /**
   * Get all event values as array
   */
  static getAllEvents(): string[] {
    return Object.values(LemonSqueezyEvent);
  }

  /**
   * Validate if event is a known LemonSqueezy event
   */
  static isValidEvent(event: string): boolean {
    return Object.values(LemonSqueezyEvent).includes(event as LemonSqueezyEvent);
  }
}