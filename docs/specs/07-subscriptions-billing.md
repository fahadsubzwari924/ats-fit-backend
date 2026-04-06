---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Subscriptions and billing (intended behavior)

> This document describes **intended business behavior**. Webhook wiring in the HTTP layer should be kept consistent with this; if it diverges, treat that as a **bug** to fix, not as spec.

## Business intent

Let users **discover plans**, **pay through a trusted gateway**, and receive **entitlements** (limits/features) automatically while finance retains an **audit trail** of payments and subscription state.

## Traceability

| ID | Kind |
|----|------|
| REQ-008 | Functional |
| US-5 | User story |
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

## Plans

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

1. **Parse** notification: require enough data to identify **user** (e.g. email in custom/meta payload) and **plan** (plan id in custom data). Exact gateway JSON shape: **see runbook** (Lemon Squeezy–style `meta` / `data` is assumed in `PaymentHistoryService` validators).
2. **Verify signature** when the gateway sends a signature header and the webhook secret is configured in env; in development, verification may be relaxed—**see code and runbook**.
3. **Idempotency:** If the same external payment id was already stored, **do not** duplicate payment history.
4. **Persist payment history** for audit (status, amounts, raw payload reference—per entity design).
5. **Branch on event outcome:**
   - **Subscription payment / activation success** → **`handleSuccessfulPayment`** path → **`processPaymentGatewayEvent`** → create or update **user subscription** and related user plan state per business rules (see `CreateSubscriptionFromPaymentGatewayDto` / `SubscriptionService.create`).
   - **Payment failed** (or explicit failure event) → **`handleFailedPayment`** path → notify user (e.g. payment-failed email template) with safe template data; do **not** activate subscription.

### Ordering (intended)

Apply **subscription state updates** and **payment history** in an order that preserves auditability: typically record or update payment row, then apply subscription side effects, or use a single transactional boundary where the DB supports it—**implementation detail** in code; runbook documents operational recovery.

## Non-production utilities

Endpoints such as **test email** may exist for debugging; **must not** be relied on in production without hardening—**see code** and remove or protect per runbook.

## Related specs

- Identity: [02-auth-and-identity.md](./02-auth-and-identity.md)
- Limits tied to plan: [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md)
- NFRs: [non-functional-requirements.md](./non-functional-requirements.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
