import { Logger } from '@nestjs/common';
import { NormalizedWebhookEvent } from '../interfaces/normalized-webhook-event.interface';
import { PaymentEventType } from '../../enums/payment-event-type.enum';
import { CreemEventType } from '../enums/creem-events.enum';
import { CREEM_STATUS_MAP } from '../models/creem-subscription.model';
import { resolveEntityId } from '../utils/resolve-entity-id.util';

/**
 * Creem Webhook Parser
 *
 * Translates a Creem webhook payload — envelope shape `{ id, eventType,
 * object }` — into the provider-neutral `NormalizedWebhookEvent`. Field
 * extraction follows the corrected table in
 * `docs/superpowers/plans/2026-08-03-lemonsqueezy-to-creem-migration.md`
 * Task 6 (an earlier draft of that table was wrong/incomplete — this table
 * is the verified one).
 *
 * `NormalizedWebhookEvent` declares `amountCents`/`currency`, but Task 6's
 * field-extraction table gives no source for either — Creem's webhook
 * objects don't reliably carry price/currency inline (see
 * `creem-subscription.model.ts`'s handling of an unexpanded `product`).
 * Rather than invent a source, both are left `undefined` here; flagged in
 * the Task 6 report for whoever needs them next (likely Task 9 by joining
 * against the local `subscription_plans` row).
 *
 * `parseWebhook` must never throw: the controller returns HTTP 200 for
 * events it cannot act on, and a thrown error here would turn that into a
 * non-200, driving Creem's 30s/1m/5m/1h webhook retry schedule for a payload
 * we could never have parsed anyway. Any failure degrades to an `UNKNOWN`
 * event with a `warn` log.
 *
 * Static, dependency-free (no `@Injectable()`, no constructor DI) — same
 * precedent as `CreemWebhookVerifier` / `IdValidator`.
 */

/**
 * `CreemEventType -> PaymentEventType` lookup. Deliberately NOT exported —
 * it has exactly one consumer (this class) and exporting it invites
 * divergent reuse elsewhere. `subscription.unpaid` has no entry in the
 * Task 6 plan table and is intentionally left unmapped (-> UNKNOWN).
 *
 * A `Map`, not a plain object literal: `eventType` is an ordinary
 * attacker-controlled JSON string field, and a plain-object lookup inherits
 * from `Object.prototype`. `{}['__proto__']`/`['constructor']` resolve to
 * real (truthy) prototype members, so `plainObject[eventType] ?? UNKNOWN`
 * would silently return `Object.prototype`/`Function` for those keys instead
 * of falling through to `UNKNOWN` — no getters or Proxies required, just
 * `JSON.parse` of a normal request body. `Map.prototype.get` has no
 * prototype-chain fallback, so this is structurally impossible rather than
 * guarded by convention.
 */
const EVENT_TYPE_MAP: ReadonlyMap<CreemEventType, PaymentEventType> = new Map([
  [CreemEventType.CHECKOUT_COMPLETED, PaymentEventType.SUBSCRIPTION_ACTIVATED],
  [CreemEventType.SUBSCRIPTION_ACTIVE, PaymentEventType.SUBSCRIPTION_ACTIVATED],
  [CreemEventType.SUBSCRIPTION_PAID, PaymentEventType.SUBSCRIPTION_RENEWED],
  [
    CreemEventType.SUBSCRIPTION_PAST_DUE,
    PaymentEventType.SUBSCRIPTION_PAYMENT_FAILED,
  ],
  [
    CreemEventType.SUBSCRIPTION_SCHEDULED_CANCEL,
    PaymentEventType.SUBSCRIPTION_CANCEL_SCHEDULED,
  ],
  [
    CreemEventType.SUBSCRIPTION_CANCELED,
    PaymentEventType.SUBSCRIPTION_CANCELLED,
  ],
  [CreemEventType.SUBSCRIPTION_EXPIRED, PaymentEventType.SUBSCRIPTION_EXPIRED],
  [CreemEventType.SUBSCRIPTION_PAUSED, PaymentEventType.SUBSCRIPTION_PAUSED],
  [
    CreemEventType.SUBSCRIPTION_TRIALING,
    PaymentEventType.SUBSCRIPTION_TRIALING,
  ],
  [CreemEventType.SUBSCRIPTION_UPDATE, PaymentEventType.SUBSCRIPTION_UPDATED],
  [CreemEventType.REFUND_CREATED, PaymentEventType.PAYMENT_REFUNDED],
  [CreemEventType.DISPUTE_CREATED, PaymentEventType.PAYMENT_DISPUTED],
]);

type EntityRelation = { id: string } | string | undefined | null;

export class CreemWebhookParser {
  private static readonly logger = new Logger(CreemWebhookParser.name);

  static parse(rawPayload: unknown): NormalizedWebhookEvent {
    try {
      return this.buildNormalizedEvent(rawPayload);
    } catch (error) {
      // No catch on this path may resolve to a "real" (non-UNKNOWN) event —
      // degrade and log, never throw.
      this.logger.warn(
        'Failed to parse Creem webhook payload; degrading to UNKNOWN event',
        {
          reason: error instanceof Error ? error.message : 'unknown-error',
        },
      );

      return {
        eventId: this.safeReadString(rawPayload, 'id') ?? 'unknown',
        type: PaymentEventType.UNKNOWN,
        rawType: this.safeReadString(rawPayload, 'eventType') ?? 'unknown',
        // Ambiguous/unparseable payload — never mistaken for a real payment.
        isTestMode: true,
        metadata: {},
        raw: rawPayload,
      };
    }
  }

  private static buildNormalizedEvent(
    rawPayload: unknown,
  ): NormalizedWebhookEvent {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new Error('payload is not an object');
    }

    const envelope = rawPayload as Record<string, unknown>;

    const id = envelope.id;
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('missing envelope.id');
    }

    const eventType = envelope.eventType;
    if (typeof eventType !== 'string' || eventType.length === 0) {
      throw new Error('missing envelope.eventType');
    }

    const object = envelope.object;
    if (!object || typeof object !== 'object') {
      throw new Error('missing envelope.object');
    }
    const obj = object as Record<string, unknown>;

    const type =
      EVENT_TYPE_MAP.get(eventType as CreemEventType) ??
      PaymentEventType.UNKNOWN;

    const status =
      typeof obj.status === 'string'
        ? CREEM_STATUS_MAP.get(obj.status)
        : undefined;

    return {
      eventId: id,
      type,
      rawType: eventType,
      gatewaySubscriptionId: this.extractSubscriptionId(eventType, obj),
      gatewayTransactionId: this.extractTransactionId(obj, id),
      gatewayCustomerId: resolveEntityId(obj.customer as EntityRelation),
      gatewayProductId: resolveEntityId(obj.product as EntityRelation),
      // No `?? SubscriptionStatus.EXPIRED` fallback here — `status` is
      // optional on `NormalizedWebhookEvent`; an unmapped Creem status must
      // stay `undefined`, never silently become EXPIRED. That fallback is
      // correct only in the read path (`buildCancelSubscriptionResponse` in
      // `creem-payment.gateway.ts`), not here.
      status,
      periodStart: this.parseDate(obj.currentPeriodStartDate),
      periodEnd: this.parseDate(obj.currentPeriodEndDate),
      cancelledAt: this.parseDate(obj.canceledAt),
      customerEmail: this.extractCustomerEmail(obj),
      isTestMode: obj.mode !== 'prod',
      metadata: this.extractMetadata(obj),
      raw: rawPayload,
    };
  }

  /**
   * `rawType.startsWith('subscription.')` events carry the subscription id
   * directly as `object.id` (the object IS the subscription). Every other
   * event (`checkout.completed`, `refund.created`, `dispute.created`) nests
   * it under `object.subscription`, a `{id} | string | undefined` union.
   */
  private static extractSubscriptionId(
    eventType: string,
    obj: Record<string, unknown>,
  ): string | undefined {
    if (eventType.startsWith('subscription.')) {
      return typeof obj.id === 'string' ? obj.id : undefined;
    }

    return resolveEntityId(obj.subscription as EntityRelation);
  }

  /**
   * `object.lastTransactionId ?? object.transaction?.id ?? object.order?.id
   * ?? envelope.id` — `RefundEntity`/`DisputeEntity` have no
   * `lastTransactionId` but always carry a required `transaction`.
   */
  private static extractTransactionId(
    obj: Record<string, unknown>,
    envelopeId: string,
  ): string | undefined {
    if (
      typeof obj.lastTransactionId === 'string' &&
      obj.lastTransactionId.length > 0
    ) {
      return obj.lastTransactionId;
    }

    const transactionId = resolveEntityId(obj.transaction as EntityRelation);
    if (transactionId) {
      return transactionId;
    }

    const orderId = resolveEntityId(obj.order as EntityRelation);
    if (orderId) {
      return orderId;
    }

    return envelopeId;
  }

  /** Narrows the `CustomerEntity | string` union — a bare string id has no email to read. */
  private static extractCustomerEmail(
    obj: Record<string, unknown>,
  ): string | undefined {
    const customer = obj.customer;
    if (customer && typeof customer === 'object' && 'email' in customer) {
      const email = (customer as Record<string, unknown>).email;
      return typeof email === 'string' ? email : undefined;
    }
    return undefined;
  }

  private static extractMetadata(
    obj: Record<string, unknown>,
  ): Record<string, unknown> {
    return obj.metadata && typeof obj.metadata === 'object'
      ? (obj.metadata as Record<string, unknown>)
      : {};
  }

  /**
   * Leaves the date `undefined` when absent/unparseable — never an epoch
   * fallback. That sentinel is correct only in the read model
   * (`CreemSubscription`), not here: persisting it into `starts_at`/`ends_at`
   * would corrupt `ReplacementQuotaService`'s monthly window.
   */
  private static parseDate(value: unknown): Date | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? undefined : value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
  }

  /**
   * Used only from the outer catch's error-recovery path — reading an
   * already-untrusted payload a second time. Wrapped in its own try/catch so
   * a hostile getter that throws on every access (not reachable via
   * `JSON.parse` of a real HTTP body, but not something `parse()`'s "never
   * throws" contract may depend on staying that way) degrades to
   * `undefined` instead of escaping `parse()` as an uncaught throw.
   */
  private static safeReadString(
    payload: unknown,
    key: string,
  ): string | undefined {
    try {
      if (!payload || typeof payload !== 'object') {
        return undefined;
      }
      const value = (payload as Record<string, unknown>)[key];
      return typeof value === 'string' && value.length > 0 ? value : undefined;
    } catch {
      return undefined;
    }
  }
}
