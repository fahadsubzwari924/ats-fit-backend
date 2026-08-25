/**
 * Payment Event Type Enum
 *
 * Provider-neutral vocabulary for normalized webhook events. Every payment
 * gateway adapter (Creem, and any future provider) maps its own webhook event
 * names onto this enum so downstream services never depend on a specific
 * provider's payload shape.
 */
export enum PaymentEventType {
  SUBSCRIPTION_ACTIVATED = 'subscription.activated',
  SUBSCRIPTION_RENEWED = 'subscription.renewed',
  SUBSCRIPTION_PAYMENT_FAILED = 'subscription.payment_failed',
  SUBSCRIPTION_CANCEL_SCHEDULED = 'subscription.cancel_scheduled',
  SUBSCRIPTION_CANCELLED = 'subscription.cancelled',
  SUBSCRIPTION_EXPIRED = 'subscription.expired',
  SUBSCRIPTION_PAUSED = 'subscription.paused',
  SUBSCRIPTION_UPDATED = 'subscription.updated',
  SUBSCRIPTION_TRIALING = 'subscription.trialing',
  PAYMENT_REFUNDED = 'payment.refunded',
  PAYMENT_DISPUTED = 'payment.disputed',
  UNKNOWN = 'unknown',
}
