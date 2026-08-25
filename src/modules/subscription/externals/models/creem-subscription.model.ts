import { Logger } from '@nestjs/common';
import { SubscriptionInfo } from '../interfaces/payment-gateway.interface';
import { Currency } from '../../enums/payment.enum';
import { SubscriptionStatus } from '../../enums/subscription-status.enum';
import { resolveEntityId } from '../utils/resolve-entity-id.util';

/**
 * Field-level source: `docs/specs/creem-sdk-surface.md` § "Get subscription" (camelCase —
 * the SDK deserialises the wire's snake_case into camelCase for callers).
 *
 * `product` and `customer` on `SubscriptionEntity` are `ProductEntity | string`
 * unions — either a fully expanded object or just an ID, depending on whether
 * the Creem API expanded the relation for this call. Both cases are narrowed
 * explicitly rather than accessed optimistically.
 */

/** Minimal shape this model needs from `product` when expanded (avoids an SDK import). */
interface ExpandedProduct {
  id: string;
  /** Price in cents — see `node_modules/creem/dist/commonjs/models/components/productentity.d.ts:48`. */
  price: number;
  /** Three-letter uppercase ISO currency code — same file, line 52. */
  currency: string;
}

interface ExpandedCustomer {
  id: string;
}

/** Structural shape this model reads off a Creem `SubscriptionEntity`. */
interface CreemSubscriptionSource {
  id: string;
  status: string;
  product: ExpandedProduct | string;
  customer: ExpandedCustomer | string;
  currentPeriodStartDate?: Date | null;
  currentPeriodEndDate?: Date | null;
  canceledAt?: Date | null;
}

/**
 * Creem spells this status with one "l"; unrecognised/future values must not
 * silently become ACTIVE — an unmapped status could mean the subscription
 * lost access (e.g. a new Creem status this map hasn't caught up to yet), so
 * defaulting to ACTIVE would be an availability bug in the wrong direction.
 * EXPIRED is the safe default: it reads as "no access" everywhere downstream
 * (applied at each call site via `?? SubscriptionStatus.EXPIRED`, not baked
 * into the map itself — the webhook parser reuses this same map without that
 * fallback, see `creem-webhook-parser.ts`).
 *
 * A `Map`, not a plain object literal: `subscription.status` /
 * `object.status` is an ordinary attacker-controlled JSON string field, and
 * a plain-object lookup inherits from `Object.prototype`. Looking up
 * `'__proto__'`/`'constructor'`/`'toString'` on `{}` resolves to real
 * (truthy) prototype members, so `plainObject[status] ?? EXPIRED` would
 * silently return `Object.prototype`/a function instead of falling through
 * to the fallback — no getters or Proxies needed, just `JSON.parse` of a
 * normal payload. `Map.prototype.get` has no prototype-chain fallback, so
 * this is structurally impossible rather than guarded by convention.
 */
export const CREEM_STATUS_MAP: ReadonlyMap<string, SubscriptionStatus> =
  new Map([
    ['active', SubscriptionStatus.ACTIVE],
    ['trialing', SubscriptionStatus.ACTIVE],
    ['scheduled_cancel', SubscriptionStatus.SCHEDULED_CANCEL],
    ['canceled', SubscriptionStatus.CANCELLED],
    ['expired', SubscriptionStatus.EXPIRED],
    ['paused', SubscriptionStatus.PAUSED],
    ['past_due', SubscriptionStatus.PAST_DUE],
    ['unpaid', SubscriptionStatus.PAST_DUE],
  ] as const);

export class CreemSubscription implements SubscriptionInfo {
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

  constructor(subscription: CreemSubscriptionSource, logger?: Logger) {
    const log = logger ?? new Logger(CreemSubscription.name);

    this.id = subscription.id;
    this.status =
      CREEM_STATUS_MAP.get(subscription.status) ?? SubscriptionStatus.EXPIRED;

    this.planId = resolveEntityId(subscription.product);
    this.customerId = resolveEntityId(subscription.customer);

    if (typeof subscription.product === 'string') {
      // Product wasn't expanded on this response — price/currency are simply
      // unavailable here. Never invent a price; fall back and log.
      log.debug(
        `Creem subscription ${subscription.id} returned an unexpanded product (${subscription.product}); amount/currency defaulted`,
      );
      this.amount = 0;
      this.currency = Currency.USD;
    } else {
      this.amount = subscription.product.price / 100;
      this.currency = subscription.product.currency;
    }

    // `currentPeriodStartDate`/`currentPeriodEndDate` are typed `Date | undefined`
    // on the SDK entity, but `SubscriptionInfo` requires non-optional `Date`s.
    // A real (non-draft/incomplete) subscription should always carry both; if
    // Creem ever omits one, fall back to the epoch rather than "now" — an
    // obviously-wrong sentinel is safer to spot downstream than a plausible-
    // looking but fabricated "current" date.
    if (!subscription.currentPeriodStartDate) {
      log.warn(
        `Creem subscription ${subscription.id} is missing currentPeriodStartDate`,
      );
    }
    if (!subscription.currentPeriodEndDate) {
      log.warn(
        `Creem subscription ${subscription.id} is missing currentPeriodEndDate`,
      );
    }
    this.currentPeriodStart = subscription.currentPeriodStartDate
      ? new Date(subscription.currentPeriodStartDate)
      : new Date(0);
    this.currentPeriodEnd = subscription.currentPeriodEndDate
      ? new Date(subscription.currentPeriodEndDate)
      : new Date(0);

    // Only `scheduled_cancel` means "still active, will end at period end".
    // A subscription already in `canceled` also carries a `canceledAt`, so
    // keying off that date would wrongly report an ended subscription as
    // pending-cancellation.
    this.cancelAtPeriodEnd = subscription.status === 'scheduled_cancel';
    // No clear Creem equivalent for trial end — leave undefined rather than guessing.
    this.trialEnd = undefined;
  }
}
