# LemonSqueezy → Creem Payment Gateway Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace LemonSqueezy with Creem as the sole payment gateway, and normalize webhook ingress so services never touch provider-specific JSON again.

**Architecture:** Keep the existing `IPaymentGateway` / `PaymentGatewayFactory` / `PaymentService` abstraction. Extend the interface with `verifyWebhookSignature()` + `parseWebhook()` returning a provider-neutral `NormalizedWebhookEvent`. `SubscriptionController` becomes verify → parse → route; `SubscriptionService` and `PaymentHistoryService` consume only the normalized event. LemonSqueezy is deleted entirely.

**Tech Stack:** NestJS 11, TypeORM, PostgreSQL, `creem` npm SDK, Jest.

**Preconditions:** Zero paying customers (product in beta) — no subscription data migration, no dual-running, hard cutover is safe.

---

## Decisions locked (from review)

| Decision | Choice |
|---|---|
| Webhook layer | Normalize to internal event shape |
| LemonSqueezy code | Delete entirely |
| Cancellation | `mode: scheduled` — access retained until period end |
| HTTP client | Official `creem` npm SDK |

## Architectural notes carried into the tasks

1. **`subscription.paid` fires on every renewal with the same subscription ID.** Idempotency must key on the *transaction* ID, not the subscription ID, or renewals after the first get silently swallowed.
2. **Creem keeps one subscription row across renewals; LemonSqueezy created a new one.** `replacement-quota.service.ts:203` explicitly relies on `starts_at` being the *current* period start. Under Creem, `starts_at` must be refreshed from `current_period_start_date` on every `subscription.paid`, otherwise the monthly replacement quota never resets.
3. **`subscription.scheduled_cancel` ≠ cancelled.** It must flag `is_cancelled` while leaving `is_active` true; the downgrade happens on `subscription.expired`.
4. **Pre-existing security bug fixed in-flight:** `subscription.service.ts:500` returns `true` when the signature header is absent, on a `@Public()` endpoint. Anyone can forge a payment event today.
5. **SDK surface is unverified.** Published docs and the SDK README disagree (`checkouts.create` vs `createCheckout`, `customers.generateBillingLinks` vs `generateCustomerLinks`). Task 1 pins the real surface before any adapter code is written; `CreemService` is the only file allowed to reference SDK symbols.

## File structure

**Create**
| Path | Responsibility |
|---|---|
| `src/modules/subscription/enums/payment-event-type.enum.ts` | Internal, provider-neutral webhook event types |
| `src/modules/subscription/externals/interfaces/normalized-webhook-event.interface.ts` | `NormalizedWebhookEvent` contract |
| `src/modules/subscription/externals/services/creem.service.ts` | Only file that imports the `creem` SDK |
| `src/modules/subscription/externals/gateways/creem-payment.gateway.ts` | `IPaymentGateway` impl: outbound calls + webhook parse/verify |
| `src/modules/subscription/externals/models/creem-subscription.model.ts` | Creem subscription object → `SubscriptionInfo` |
| `src/modules/subscription/externals/enums/creem-events.enum.ts` | Raw Creem `eventType` strings |
| `src/database/migrations/<ts>-RenameVariantToProductAndAddCustomerId.ts` | Schema rename + new column |
| `src/modules/subscription/tests/creem-webhook.spec.ts` | Parse + verify unit tests |

**Delete**
`externals/services/lemon_squeezy.service.ts`, `externals/gateways/lemonsqueezy-payment.gateway.ts`, `externals/models/lemonsqueezy-subscription.model.ts`, `externals/enums/external-payment-gateway-events.enum.ts`, `dtos/payment-confirmation.dto.ts`, `dtos/create-subscription-from-payment-gateway.dto.ts`, `src/scripts/demonstrate-payment-switching.ts`, `debug-subscription-webhook.js`, dependency `@lemonsqueezy/lemonsqueezy.js`.

**Modify**
`subscription.controller.ts`, `services/subscription.service.ts`, `services/payment-history.service.ts`, `externals/interfaces/payment-gateway.interface.ts`, `externals/factories/payment-gateway.factory.ts`, `enums/payment-provider.enum.ts`, `enums/subscription-status.enum.ts`, `subscription.module.ts`, `shared/shared.module.ts`, `main.ts`, `config/configuration.ts`, `config/validation.schema.ts`, `database/entities/subscription-plan.entity.ts`, `database/entities/user-subscription.entity.ts`, `scripts/seed/seed-subscription-plans-service.ts`, `tests/payment-abstraction.spec.ts`.

---

### Task 1: Pin the Creem SDK and record its real surface

**path:** `package.json`, `docs/specs/creem-sdk-surface.md`
**intent:** Install `creem`, and capture the actual method names/argument shapes from the shipped `.d.ts` so no later task guesses.
**agency:** `Backend Architect` / `@agency-backend-architect.mdc`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1:** `npm install creem` and `npm uninstall @lemonsqueezy/lemonsqueezy.js`
- [ ] **Step 2:** Inspect the shipped types — do not trust the web docs:

```bash
ls node_modules/creem/dist/
grep -rn "createCheckout\|checkouts\|cancelSubscription\|generateBillingLinks\|generateCustomerLinks\|verifyWebhookSignature" node_modules/creem/*.d.ts node_modules/creem/dist/**/*.d.ts | head -40
```

- [ ] **Step 3:** Write `docs/specs/creem-sdk-surface.md` recording, verbatim: installed version, constructor options (`apiKey`, `serverIdx` vs `serverURL`), and the exact signature for create-checkout, get-subscription, cancel-subscription, customer-billing-link, and any webhook-verify helper. If a helper does not exist, note "verify manually via crypto HMAC-SHA256".
- [ ] **Step 4:** Commit.

```bash
git add package.json package-lock.json docs/specs/creem-sdk-surface.md
git commit -m "chore(payments): pin creem sdk, drop lemonsqueezy dep, record sdk surface"
```

**verify:** `docs/specs/creem-sdk-surface.md` exists and every signature in it is quoted from `node_modules/creem`, not from the web.

---

### Task 2: Internal payment event types

**path:** `src/modules/subscription/enums/payment-event-type.enum.ts`, `src/modules/subscription/externals/interfaces/normalized-webhook-event.interface.ts`
**intent:** Define the provider-neutral vocabulary every downstream service will consume.
**agency:** `Backend Architect` / `@agency-backend-architect.mdc`
**docs:** `docs/CONVENTIONS.md` (type placement rules)

- [ ] **Step 1:** Create the enum.

```ts
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
```

- [ ] **Step 2:** Create the normalized event interface.

```ts
import { PaymentEventType } from '../../enums/payment-event-type.enum';
import { SubscriptionStatus } from '../../enums/subscription-status.enum';
import { Currency } from '../../enums/payment.enum';

export interface NormalizedWebhookEvent {
  eventId: string;
  type: PaymentEventType;
  rawType: string;
  gatewaySubscriptionId?: string;
  gatewayTransactionId?: string;
  gatewayCustomerId?: string;
  gatewayProductId?: string;
  status?: SubscriptionStatus;
  amountCents?: number;
  currency?: Currency;
  periodStart?: Date;
  periodEnd?: Date;
  cancelledAt?: Date;
  customerEmail?: string;
  isTestMode: boolean;
  metadata: Record<string, unknown>;
  raw: unknown;
}
```

- [ ] **Step 3:** `npm run build` → expect clean compile. Commit.

**verify:** `npm run build` exits 0.

---

### Task 3: Extend the gateway contract and status vocabulary

**path:** `src/modules/subscription/externals/interfaces/payment-gateway.interface.ts`, `src/modules/subscription/enums/payment-provider.enum.ts`, `src/modules/subscription/enums/subscription-status.enum.ts`
**intent:** Make webhook verify/parse first-class interface members and add the `CREEM` provider + `SCHEDULED_CANCEL` status.
**agency:** `Backend Architect` / `@agency-backend-architect.mdc`
**docs:** `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`

- [ ] **Step 1:** In `payment-gateway.interface.ts`, make verification required and add parsing:

```ts
  /** Verify webhook authenticity against the raw request body. */
  verifyWebhookSignature(signature: string, rawBody: string): boolean;

  /** Translate a provider webhook payload into the internal event shape. */
  parseWebhook(rawPayload: unknown): NormalizedWebhookEvent;
```

- [ ] **Step 2:** Add `CREEM = 'creem'` to `PaymentProvider`.
- [ ] **Step 3:** Add `SCHEDULED_CANCEL = 'scheduled_cancel'` to `SubscriptionStatus`.
- [ ] **Step 4:** `npm run build` — expect it to FAIL, pointing at `LemonSqueezyPaymentGateway` (missing `parseWebhook`). This is the intended signal that the old adapter is now non-conforming; it is deleted in Task 11. Leave it broken and continue, or stub `parseWebhook` to `throw new Error('removed')` to keep the build green between tasks.
- [ ] **Step 5:** Commit.

**verify:** `PaymentProvider.CREEM` and `SubscriptionStatus.SCHEDULED_CANCEL` resolve; interface exports the two new members.

---

### Task 4: CreemService — the only SDK-aware file

**path:** `src/modules/subscription/externals/services/creem.service.ts`
**intent:** Wrap the four SDK calls behind repo-native methods and error types, using the exact signatures recorded in Task 1.
**agency:** `Backend Architect` / `@agency-backend-architect.mdc`
**docs:** `docs/specs/creem-sdk-surface.md`, `docs/ERROR-HANDLING.md`, `docs/API-PATTERNS.md`

- [ ] **Step 1:** Implement `CreemService` with a client built once in the constructor. Base URL is chosen by environment — Creem uses a *different host* per mode, not a `testMode` flag:

```ts
const isProd = this.configService.get<string>('NODE_ENV') === 'production';
const serverURL = isProd ? 'https://api.creem.io' : 'https://test-api.creem.io';
```

- [ ] **Step 2:** Expose exactly four methods, each translating SDK errors into the repo's `custom-http-exceptions` per `docs/ERROR-HANDLING.md`:
  - `createCheckoutSession({ productId, email, metadata, discountCode, successUrl })`
  - `getSubscription(subscriptionId)`
  - `cancelSubscription(subscriptionId, mode: 'scheduled' | 'immediate')`
  - `getCustomerBillingLink(customerId)`
- [ ] **Step 3:** Build the success URL exactly as the old service did (`SUBSCRIPTION_SUCCESS_URL` + `?payment=success`) so the frontend's existing `?payment=success` check keeps working — Creem appends its own params additively.
- [ ] **Step 4:** `npm run build`, then commit.

**verify:** `npm run build` exits 0; `grep -rn "from 'creem'" src/` returns only `creem.service.ts`.

---

### Task 5: CreemPaymentGateway — outbound half

**path:** `src/modules/subscription/externals/gateways/creem-payment.gateway.ts`, `src/modules/subscription/externals/models/creem-subscription.model.ts`
**intent:** Implement `createCheckout`, `getSubscription`, `cancelSubscription`, `createCustomerPortal`, `getCustomerSubscriptions` against `IPaymentGateway`.
**agency:** `Backend Architect` / `@agency-backend-architect.mdc`
**docs:** `docs/CONVENTIONS.md`, `docs/ERROR-HANDLING.md`

- [ ] **Step 1:** Write `creem-subscription.model.ts` mapping the Creem subscription object onto `SubscriptionInfo`:

| `SubscriptionInfo` | Creem field |
|---|---|
| `id` | `id` |
| `status` | `status` (via status map below) |
| `planId` | `product.id` ?? `product` |
| `customerId` | `customer.id` ?? `customer` |
| `currentPeriodStart` | `current_period_start_date` |
| `currentPeriodEnd` | `current_period_end_date` |
| `cancelAtPeriodEnd` | `status === 'scheduled_cancel'` |

Status map — note Creem spells it `canceled` with one L, and unknown values must **not** fall through to ACTIVE:

```ts
const CREEM_STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: SubscriptionStatus.ACTIVE,
  trialing: SubscriptionStatus.ACTIVE,
  scheduled_cancel: SubscriptionStatus.SCHEDULED_CANCEL,
  canceled: SubscriptionStatus.CANCELLED,
  expired: SubscriptionStatus.EXPIRED,
  paused: SubscriptionStatus.PAUSED,
  past_due: SubscriptionStatus.PAST_DUE,
  unpaid: SubscriptionStatus.PAST_DUE,
};
```

- [ ] **Step 2:** Implement the gateway. `createCheckout` maps `variantId → productId`, `customData → metadata`, `discountCode → discountCode`. `cancelSubscription` passes `mode: 'scheduled'`. `createCustomerPortal` calls the billing-link method.
- [ ] **Step 3:** Keep `getCustomerSubscriptions` returning `[]` with a warn log — it is unused today and out of scope.
- [ ] **Step 4:** `npm run build`, commit.

**verify:** `npm run build` exits 0.

---

### Task 6: Webhook verification and parsing (TDD)

**path:** `src/modules/subscription/externals/gateways/creem-payment.gateway.ts`, `src/modules/subscription/externals/enums/creem-events.enum.ts`, `src/modules/subscription/tests/creem-webhook.spec.ts`
**intent:** Verify `creem-signature` over the raw body, and translate Creem events into `NormalizedWebhookEvent`.
**agency:** `Security Engineer` / `@agency-security-engineer.mdc`
**docs:** `docs/SECURITY.md`, `docs/TESTING-STRATEGY.md`

- [ ] **Step 1: Write the failing tests** in `creem-webhook.spec.ts`, covering:
  - a body signed with the correct secret verifies;
  - a tampered body fails;
  - **an empty/missing signature fails** (this is the bypass bug — must be asserted);
  - `subscription.paid` parses to `SUBSCRIPTION_RENEWED` with `gatewayTransactionId` from `object.last_transaction_id`;
  - `checkout.completed` reads the subscription ID from `object.subscription.id`;
  - `subscription.scheduled_cancel` parses to `SUBSCRIPTION_CANCEL_SCHEDULED`, not `SUBSCRIPTION_CANCELLED`;
  - an unrecognised `eventType` yields `PaymentEventType.UNKNOWN` and never throws.

- [ ] **Step 2: Run and confirm failure** — `npx jest src/modules/subscription/tests/creem-webhook.spec.ts` → FAIL.

- [ ] **Step 3: Implement `verifyWebhookSignature`.** HMAC-SHA256 hex over the raw body, compared with `crypto.timingSafeEqual` inside a length guard. No environment escape hatch, no empty-signature pass.

- [ ] **Step 4: Implement `parseWebhook`** against the Creem envelope `{ id, eventType, created_at, object }` using this map:

| Creem `eventType` | `PaymentEventType` |
|---|---|
| `checkout.completed` | `SUBSCRIPTION_ACTIVATED` |
| `subscription.active` | `SUBSCRIPTION_ACTIVATED` |
| `subscription.paid` | `SUBSCRIPTION_RENEWED` |
| `subscription.past_due` | `SUBSCRIPTION_PAYMENT_FAILED` |
| `subscription.scheduled_cancel` | `SUBSCRIPTION_CANCEL_SCHEDULED` |
| `subscription.canceled` | `SUBSCRIPTION_CANCELLED` |
| `subscription.expired` | `SUBSCRIPTION_EXPIRED` |
| `subscription.paused` | `SUBSCRIPTION_PAUSED` |
| `subscription.trialing` | `SUBSCRIPTION_TRIALING` |
| `subscription.update` | `SUBSCRIPTION_UPDATED` |
| `refund.created` | `PAYMENT_REFUNDED` |
| `dispute.created` | `PAYMENT_DISPUTED` |

Field extraction: `gatewaySubscriptionId` = `object.id` for `subscription.*`, `object.subscription?.id ?? object.subscription` for `checkout.completed`; `gatewayTransactionId` = `object.last_transaction_id ?? object.order?.id ?? envelope.id`; `metadata` = `object.metadata ?? {}`; `customerEmail` = `object.customer?.email`.

- [ ] **Step 5: Run tests** → PASS. Commit.

**verify:** `npx jest src/modules/subscription/tests/creem-webhook.spec.ts` — all pass, including the empty-signature rejection.

---

### Task 7: Rewire the webhook controller

**path:** `src/modules/subscription/controllers/subscription.controller.ts:594-725`
**intent:** Replace the LS-shaped ingress with verify → parse → route on normalized events, and close the signature bypass.
**agency:** `Security Engineer` / `@agency-security-engineer.mdc`
**docs:** `docs/SECURITY.md`, `docs/API-PATTERNS.md`

- [ ] **Step 1:** Change the handler signature: read `@Headers('creem-signature')`, accept the body as `unknown` (drop `PaymentConfirmationDto`), keep `RawBodyRequest`.
- [ ] **Step 2:** Verify via `this.paymentService.verifyWebhookSignature(signature, req.rawBody.toString('utf8'))` and reject with 400 before any state mutation. If `req.rawBody` is absent, reject — never fall back to `JSON.stringify(payload)`, which does not round-trip byte-for-byte.
- [ ] **Step 3:** Parse via `this.paymentService.parseWebhook(payload)`, then resolve user/plan from `event.metadata.user_id` / `event.metadata.plan_id`, falling back to `event.customerEmail` for user lookup.
- [ ] **Step 4:** Rewrite `routeWebhookEvent` on `PaymentEventType`:

| Event | Handler |
|---|---|
| `SUBSCRIPTION_ACTIVATED`, `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_TRIALING` | `handleSuccessfulPayment` |
| `SUBSCRIPTION_PAYMENT_FAILED` | `handleFailedPayment` |
| `SUBSCRIPTION_CANCEL_SCHEDULED` | `handleCancellationScheduled` (new — keeps access) |
| `SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_EXPIRED` | `handleSubscriptionDeactivated` |
| `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_PAUSED` | `handleSubscriptionUpdated` |
| `PAYMENT_REFUNDED`, `PAYMENT_DISPUTED`, `UNKNOWN` | log + record history only |

- [ ] **Step 5:** Return HTTP 200 for handled-but-unrouted events so Creem does not enter its 30s/1m/5m/1h retry cycle.
- [ ] **Step 6:** `npm run build`, `npm run lint`, commit.

**verify:** `npm run build` exits 0; `grep -n "x-signature\|PaymentConfirmationDto" src/modules/subscription/controllers/subscription.controller.ts` returns nothing.

---

### Task 8: Rewire SubscriptionService

**path:** `src/modules/subscription/services/subscription.service.ts`
**intent:** Consume `NormalizedWebhookEvent`; add scheduled-cancel handling; refresh period dates on renewal; delete the LS signature method.
**agency:** `Backend Architect` / `@agency-backend-architect.mdc`
**docs:** `docs/ARCHITECTURE.md`, `docs/ERROR-HANDLING.md`

- [ ] **Step 1:** Delete `verifySignature()` (`:498-524`) — verification now lives in the gateway (Task 6) and is reached via `PaymentService`.
- [ ] **Step 2:** Replace `CreateSubscriptionFromPaymentGatewayDto` with a private mapper from `NormalizedWebhookEvent` → `ICreateSubscriptionData`, sourcing `starts_at`/`ends_at` from `periodStart`/`periodEnd`.
- [ ] **Step 3:** In `processPaymentGatewayEvent`, when a subscription already exists, **also refresh `starts_at` and `ends_at`** from the event:

```ts
const updated = await this.update(existing.id, {
  status: event.status,
  is_active: event.status === SubscriptionStatus.ACTIVE,
  ...(event.periodStart ? { starts_at: event.periodStart } : {}),
  ...(event.periodEnd ? { ends_at: event.periodEnd } : {}),
});
```

Without this, `ReplacementQuotaService.resolveMonthlyWindow` (`replacement-quota.service.ts:203`) keeps anchoring on the original signup date and the monthly replacement quota never resets — LemonSqueezy created a fresh row per renewal, Creem does not.

- [ ] **Step 4:** Add `handleCancellationScheduled(event, user)`: set `is_cancelled = true`, `cancelled_at = now`, `status = SCHEDULED_CANCEL`, and **leave `is_active` true** — no `downgradeToFreemium()` call.
- [ ] **Step 5:** In `cancelUserSubscription` (`:411-462`), stop downgrading immediately. Call the gateway (scheduled), then set `is_cancelled = true` / `cancelled_at` / `status = SCHEDULED_CANCEL`, keep `is_active` true, and return. The downgrade now happens only via the `subscription.expired` webhook.
- [ ] **Step 6:** `npm run build`, commit.

**verify:** `npm run build` exits 0; `grep -n "LEMON_SQUEEZY\|lemonSqueezy" src/modules/subscription/services/subscription.service.ts` returns nothing.

---

### Task 9: Rewire PaymentHistoryService

**path:** `src/modules/subscription/services/payment-history.service.ts`
**intent:** Build history rows from the normalized event and fix renewal idempotency.
**agency:** `Backend Architect` / `@agency-backend-architect.mdc`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1:** Change `paymentConfirmation(paymentGatewayData: any)` to `paymentConfirmation(event: NormalizedWebhookEvent)`.
- [ ] **Step 2:** Set `payment_gateway_transaction_id = event.gatewayTransactionId`. This is the idempotency key checked by `checkExistingPayment` — it must be the *transaction*, never the subscription ID, or every renewal after the first is discarded as a duplicate.
- [ ] **Step 3:** Delete `extractCustomData()` (`:460-520`) and its seven speculative payload paths; read `event.metadata` directly. Delete `extractFailureReason()` — it is dead code with no callers.
- [ ] **Step 4:** Amounts: `amount = event.amountCents / 100`; `currency = event.currency`; `customer_email = event.customerEmail`; `is_test_mode = event.isTestMode`; `payment_gateway_response = event.raw`.
- [ ] **Step 5:** Plan resolution: `event.metadata.plan_id` first, then `findByProductId(event.gatewayProductId)` (renamed in Task 10).
- [ ] **Step 6:** `npm run build`, commit.

**verify:** `npm run build` exits 0; `grep -n "data?.attributes" src/modules/subscription/services/payment-history.service.ts` returns nothing.

---

### Task 10: Schema migration — product ID rename + customer ID column

**path:** `src/database/migrations/<timestamp>-RenameVariantToProductAndAddCustomerId.ts`, `src/database/entities/subscription-plan.entity.ts`, `src/database/entities/user-subscription.entity.ts`, `src/modules/subscription/services/subscription-plan.service.ts`
**intent:** Creem has no variants; store `payment_gateway_customer_id` so the portal link can be generated without digging through the metadata blob.
**agency:** `Database Optimizer` / `@agency-database-optimizer.mdc`
**docs:** `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1:** Generate the migration and hand-write it:

```sql
ALTER TABLE "subscription_plans" RENAME COLUMN "payment_gateway_variant_id" TO "payment_gateway_product_id";
ALTER TABLE "user_subscriptions" ADD COLUMN "payment_gateway_customer_id" character varying;
CREATE INDEX "IDX_user_subscriptions_payment_gateway_customer_id" ON "user_subscriptions" ("payment_gateway_customer_id");
```

Include a symmetric `down()`. The unique index on the renamed column is carried by `RENAME COLUMN` — confirm with `\d subscription_plans` after running.

- [ ] **Step 2:** Rename the entity property in `subscription-plan.entity.ts:33-34`; add the new column to `user-subscription.entity.ts`.
- [ ] **Step 3:** Rename `SubscriptionPlanService.findByVariantId` → `findByProductId` and update its two call sites (`payment-history.service.ts`, `subscription.controller.ts:206`).
- [ ] **Step 4:** Populate `payment_gateway_customer_id` from `event.gatewayCustomerId` in the Task 8 create/update paths.
- [ ] **Step 5:** Run `npm run migration:run` against local Postgres.
- [ ] **Step 6:** Commit.

**verify:** `npm run migration:run` succeeds; `npm run migration:revert` then re-run succeeds; `grep -rn "payment_gateway_variant_id\|findByVariantId" src/ --include="*.ts"` returns only files under `migrations-legacy/` and `migrations-archive/`.

---

### Task 11: Wire Creem, delete LemonSqueezy, update config

**path:** `subscription.module.ts`, `shared/shared.module.ts`, `externals/factories/payment-gateway.factory.ts`, `main.ts`, `config/configuration.ts`, `config/validation.schema.ts`, plus all deletions
**intent:** Make Creem the active provider and remove every LemonSqueezy trace.
**agency:** `Minimal Change Engineer` / `@agency-minimal-change-engineer.mdc`
**docs:** `docs/CONVENTIONS.md`, `docs/SECURITY.md`

- [ ] **Step 1:** Delete the eight files listed under "Delete" in the file-structure section above.
- [ ] **Step 2:** `payment-gateway.factory.ts` — inject `CreemPaymentGateway`, return it for `PaymentProvider.CREEM`, change the `PAYMENT_PROVIDER` default from `LEMONSQUEEZY` to `CREEM`, and drop the `LEMONSQUEEZY` case.
- [ ] **Step 3:** Swap the LS providers for `CreemService` + `CreemPaymentGateway` in both `subscription.module.ts:40-41` and `shared.module.ts:58-59`.
- [ ] **Step 4:** `main.ts` — delete the `lemonSqueezySetup()` block (`:17`, `:24-26`) and update the ngrok webhook-URL log (`:183`) to say Creem. Keep `rawBody: true` — signature verification depends on it.
- [ ] **Step 5:** `configuration.ts` — replace the `lemonSqueezy` block (`:70-73`) with `creem: { apiKey, webhookSecret, foundingDiscountCode }`. `validation.schema.ts` — replace the three `LEMON_SQUEEZY_*` entries (`:62-65`) with `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_FOUNDING_DISCOUNT_CODE`.
- [ ] **Step 6:** `subscription.controller.ts:223` — `process.env.LS_FOUNDING_COUPON_CODE` → `this.configService.get('CREEM_FOUNDING_DISCOUNT_CODE')`.
- [ ] **Step 7:** Update `.env.dev` / `.env.staging` / `.env.prod` (gitignored) with the new keys and delete the `LEMON_SQUEEZY_*` lines. **Revoke the LemonSqueezy API keys in their dashboard** — they are live secrets sitting in plaintext on disk.
- [ ] **Step 8:** Update `tests/payment-abstraction.spec.ts` to mock `parseWebhook` + `verifyWebhookSignature` and assert `PaymentProvider.CREEM`.
- [ ] **Step 9:** `npm run build && npm run lint && npx jest` — all green. Commit.

**verify:** `grep -rni "lemon" src/ --include="*.ts" | grep -v migrations-legacy | grep -v migrations-archive` returns nothing; `npx jest` passes.

---

### Task 12: Creem dashboard setup, reseed, and test-mode end-to-end

**path:** `src/scripts/seed/seed-subscription-plans-service.ts`, Creem dashboard
**intent:** Create the real products/discount/webhook and prove the full loop in test mode.
**agency:** `API Tester` / `@agency-api-tester.mdc`
**docs:** `docs/TESTING-STRATEGY.md`, `docs/specs/07-subscriptions-billing.md`

- [ ] **Step 1:** In the Creem dashboard create two recurring products — Pro Monthly $12/month and Pro Annual $89/year — matching `seed-subscription-plans-service.ts:19-50`. Record the `prod_*` IDs.
- [ ] **Step 2:** Recreate the founding-rate discount; record its code into `CREEM_FOUNDING_DISCOUNT_CODE`.
- [ ] **Step 3:** Register the webhook endpoint `<tunnel>/api/v1/subscriptions/payment-confirmation` and copy the signing secret into `CREEM_WEBHOOK_SECRET`.
- [ ] **Step 4:** Replace the two `payment_gateway_variant_id: '1012070' / '1012071'` values with the `prod_*` IDs under the renamed property, then `npm run seed:subscription-plans`.
- [ ] **Step 5:** Run `npm run start:dev` + `npm run ngrok`, and walk the full flow with card `4111 1111 1111 1111`:
  1. `POST /subscriptions/checkout` → returns a `checkout_url`;
  2. pay → `checkout.completed` + `subscription.active` arrive, signature verifies, `user_subscriptions` row created, user is premium;
  3. `DELETE /subscriptions/:id/cancel` → Creem shows scheduled cancel, local row has `is_cancelled = true` **and `is_active` still true**, user retains premium;
  4. replay a `subscription.paid` event → **no duplicate** `payment_history` row for the same transaction ID, but `starts_at`/`ends_at` do advance;
  5. POST a forged body with no `creem-signature` header → **400**, no DB writes.
- [ ] **Step 6:** Record the results in the PR description. Commit the seed change.

**verify:** All five sub-flows behave as described; step 5 in particular must return 400.

---

### Task 13: Documentation

**path:** `docs/ARCHITECTURE.md`, `docs/specs/07-subscriptions-billing.md`, `src/modules/subscription/README.md`, `docs/SYSTEM-DESIGN.md`, `../ats-fit-frontend/src/app/features/billing/constants/billing-activation.constants.ts:95`
**intent:** Bring docs in line with the Creem architecture.
**agency:** `Technical Writer` / `@agency-technical-writer.mdc`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1:** Update the subscription README and `docs/specs/07-subscriptions-billing.md` — Creem products (no variants), the normalized webhook pipeline, and scheduled-cancel semantics.
- [ ] **Step 2:** Update the payment-gateway section of `docs/ARCHITECTURE.md` and any LemonSqueezy mention in `docs/SYSTEM-DESIGN.md`.
- [ ] **Step 3:** Fix the stale `LemonSqueezyService.buildSuccessRedirectUrl` comment in the frontend constants file.
- [ ] **Step 4:** Commit.

**verify:** `grep -rni "lemon" docs/ src/modules/subscription/README.md` returns only entries in `docs/superpowers/` history and this plan file.

---

## Out of scope

- Migrating existing subscriptions (there are none).
- Verifying Creem's redirect `signature` query param on the success URL — the webhook is the source of truth; worth a follow-up ticket.
- `getCustomerSubscriptions()` — still a stub, unused.
- One-time payments, licence keys, affiliates.
