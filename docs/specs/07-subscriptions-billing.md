---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-14
---

# Subscriptions and billing (intended behavior)

> This document describes **intended business behavior**. Webhook wiring in the HTTP layer should be kept consistent with this; if it diverges, treat that as a **bug** to fix, not as spec.

## Business intent

Let users **discover plans**, **pay through a trusted gateway**, and receive **entitlements** (limits/features) automatically while finance retains an **audit trail** of payments and subscription state.

## Traceability

| ID | Kind |
|----|------|
| REQ-007 | Functional |
| US-4 | User story |
| NFR-SEC-02, NFR-REL-03, NFR-DATA-02 | Non-functional |

## Acceptance criteria

- [ ] **AC-SUB-01:** User can list **active** plans and fetch a plan by id (authenticated per controller).
- [ ] **AC-SUB-02:** User with **no** active non-cancelled subscription can start **checkout** and receive provider session/URL payload.
- [ ] **AC-SUB-03:** User with an active subscription cannot create a duplicate checkout for a conflicting state (per business rule in controller/service).
- [ ] **AC-SUB-04:** **Intended webhook:** successful subscription payment creates/updates subscription and user plan state via `handleSuccessfulPayment` / `processPaymentGatewayEvent` path.
- [ ] **AC-SUB-05:** **Intended webhook:** failed payment triggers user notification path and does **not** grant active entitlement.
- [ ] **AC-SUB-06:** Duplicate gateway payment ids do not create duplicate payment history rows.
- [ ] **AC-SUB-07:** Production webhook requests are signature-verified when secret is configured (**see** NFR-SEC-02).
- [ ] **AC-SUB-08:** Authenticated user can read their payment history; admin-style user-id paths behave as implemented and documented in code.

## Pricing tiers

The product has two tiers:

| Tier | Cost | `UserPlan` value | Notes |
|------|------|-----------------|-------|
| **Freemium** | Free | `FREEMIUM` | Default on sign-up; no checkout required |
| **Pro** | Paid | `PREMIUM` | Activated via checkout → webhook flow |

Pro is offered in two billing cycles:

| Plan name | Price | Billing cycle |
|-----------|-------|---------------|
| **Pro Monthly** | $12.00 USD / month | `monthly` |
| **Pro Annual** | $89.00 USD / year | `yearly` (~38 % saving vs monthly) |

Plan names, prices, and `payment_gateway_product_id` values are seeded via `scripts/seed/seed-subscription-plans-service.ts`. Creem sells products, not variants — gateway product IDs must be set to real Creem `prod_*` ids before going live (placeholders are used in development).

### Plan entitlements (canonical)

| Entitlement | Free | Pro (Monthly + Annual) |
|---|---|---|
| Tailored resumes / month | 3 | **30 (single + batch share this pool)** |
| Cover letters / month | 1 | 15 |
| Batch tailoring | not available | up to 10 batch jobs / month, 3 resumes per batch |
| Generation history | last 30 days | full history |
| Templates | basic | all templates |
| Job application tracking | unlimited | unlimited |
| Support | community | priority |

**"Tailored resumes" is the canonical user-facing unit.** Whether produced via single tailoring or as part of a batch, every resume counts as 1 unit against the 30 (Pro) or 3 (Free) monthly limit. The 10 batch-jobs cap is a structural limit on batch UX invocations, not an additional resume budget. See [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md) for the increment rules and pre-check semantics.

## Plans API

- **`GET /subscriptions/plans`** — Active subscription plans (**JWT required**; controller uses global auth except `@Public` webhook/test utilities).
- **`GET /subscriptions/plans/:id`** — Plan by UUID (**JWT required**).

## Checkout

- **`POST /subscriptions/checkout`** — Authenticated user requests a checkout session.
- ** Preconditions:** Plan exists and is **active**; user has **no** other **active, non-cancelled** subscription.
- **Body:** Includes `plan_id` and `metadata` (e.g. email for gateway)—exact DTO in code.
- **Result:** Checkout payload from **payment abstraction** (URL/session id—**see** `PaymentService` and DTOs). Gateway credentials: **see env / runbook**.

## Reading subscription and payment data

- **`GET /subscriptions/subscriptions/:id`** — Subscription row by id.
- **`GET /subscriptions/user/subscriptions/:userId`** — All subscriptions for user.
- **`GET /subscriptions/user/payment-history/:userId`** — Payment rows for user (after user existence check).
- **`GET /subscriptions/payment-history`** — Payment history for **authenticated** user.

## Payment webhook (intended)

**Route (as implemented):** `POST /subscriptions/payment-confirmation` — **Public**; secured by **signature verification** when configured.

### Intended flow

The gateway (`CreemPaymentGateway`) never hands services raw Creem JSON. It
verifies and parses every payload into a `NormalizedWebhookEvent`
(`externals/interfaces/normalized-webhook-event.interface.ts`); everything
below consumes only that shape.

1. **Verify signature** over the raw request body, before any DB read or
   write. Creem signs under two schemes — a standard scheme with a 300s
   replay window and a legacy scheme without one; scheme selection is
   deterministic, never "try the other one on failure." An unverifiable
   request returns 400 and nothing is persisted.
2. **Parse** the payload into a `NormalizedWebhookEvent`. Parsing never
   throws — an unrecognised event type becomes `PaymentEventType.UNKNOWN`.
3. **Resolve the user** from `event.metadata.user_id` (server-derived at
   checkout). `event.customerEmail` is a fallback only, used when
   `user_id` is absent; the client-supplied `metadata.email` is never read
   for entitlement.
4. **Resolve the plan once**, from `event.metadata.plan_id` or
   `event.gatewayProductId`, and reuse the same resolution for every
   downstream step.
5. **Idempotency:** an atomic claim against `payment_history`, keyed on
   `event.gatewayTransactionId` (a `UNIQUE` DB constraint), reserves the row
   before any handler runs. A second delivery of the same transaction is
   recognised as a duplicate and the handler is skipped.
6. **Persist payment history** for audit (status, amounts sourced from the
   local `subscription_plans` row — never the webhook payload — plus a
   redacted raw payload reference).
7. **Branch on event type:**
   - **Activation / renewal / trial** (`SUBSCRIPTION_ACTIVATED`,
     `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_TRIALING`) → `handleSuccessfulPayment`
     → `processPaymentGatewayEvent` → create or update the user subscription
     and upgrade the user to premium.
   - **Payment failed** (`SUBSCRIPTION_PAYMENT_FAILED`) → `handleFailedPayment`
     → notify the user; do **not** activate the subscription.
   - **Cancellation scheduled** (`SUBSCRIPTION_CANCEL_SCHEDULED`) →
     `handleCancellationScheduled` — see "Cancellation is scheduled, not
     immediate" below.
   - **Cancelled / expired** (`SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_EXPIRED`)
     → `handleSubscriptionDeactivated` → revoke access.
8. **Mark processed** only after the handler succeeds. An exception between
   the claim and this step leaves the row unfinished, so Creem's retry
   legitimately reprocesses the event.

### Cancellation is scheduled, not immediate

`DELETE /subscriptions/:id/cancel` calls Creem in `scheduled` mode. The local
row is updated to `is_cancelled = true`, `status = SCHEDULED_CANCEL`, but
**`is_active` stays true** — the user keeps access until the period ends.
Access is revoked only when `subscription.expired` arrives. There is no
immediate-cancellation path.

### Ordering (intended)

The claim on `payment_history` is reserved **before** the subscription side
effects run, and marked processed only after they succeed — see steps 5–8
above. This makes the claim itself the auditability boundary; no separate
transaction wraps the handler, because the handler calls AWS SES and holding
a pooled DB connection across a network call would be false atomicity.

## Non-production utilities

Endpoints such as **test email** may exist for debugging; **must not** be relied on in production without hardening—**see code** and remove or protect per runbook.

## Related specs

- Identity: [02-auth-and-identity.md](./02-auth-and-identity.md)
- Limits tied to plan: [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md)
- NFRs: [non-functional-requirements.md](./non-functional-requirements.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
