/**
 * Creem Event Type Enum
 *
 * Raw Creem webhook `eventType` string literals — Creem's own vocabulary,
 * verified against `WebhookEventEntity`
 * (`node_modules/creem/dist/commonjs/models/components/webhookevententity.d.ts:17-42`,
 * see `docs/specs/creem-sdk-surface.md` § "Webhook event payload shapes").
 *
 * This enum intentionally contains ONLY Creem's raw event strings. The
 * `CreemEventType -> PaymentEventType` mapping lives as a module-private
 * constant inside `creem-webhook-parser.ts` — it has exactly one consumer
 * and does not belong here.
 */
export enum CreemEventType {
  CHECKOUT_COMPLETED = 'checkout.completed',
  REFUND_CREATED = 'refund.created',
  DISPUTE_CREATED = 'dispute.created',
  SUBSCRIPTION_ACTIVE = 'subscription.active',
  SUBSCRIPTION_TRIALING = 'subscription.trialing',
  SUBSCRIPTION_PAID = 'subscription.paid',
  SUBSCRIPTION_PAST_DUE = 'subscription.past_due',
  SUBSCRIPTION_SCHEDULED_CANCEL = 'subscription.scheduled_cancel',
  SUBSCRIPTION_CANCELED = 'subscription.canceled',
  SUBSCRIPTION_EXPIRED = 'subscription.expired',
  SUBSCRIPTION_UNPAID = 'subscription.unpaid',
  SUBSCRIPTION_UPDATE = 'subscription.update',
  SUBSCRIPTION_PAUSED = 'subscription.paused',
}
