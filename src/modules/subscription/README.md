# Subscription module

Handles plans, checkout, payment webhooks, and entitlement state. The payment
gateway is Creem, reached only through the `IPaymentGateway` abstraction —
see [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) for why, and
[`docs/specs/07-subscriptions-billing.md`](../../../docs/specs/07-subscriptions-billing.md)
for full acceptance criteria.

## Why a gateway abstraction

Services never see Creem's JSON. `CreemPaymentGateway` verifies and parses
every inbound webhook into a `NormalizedWebhookEvent`
(`externals/interfaces/normalized-webhook-event.interface.ts`); everything
downstream — `SubscriptionController`, `SubscriptionService`,
`PaymentHistoryService` — consumes only that shape. Swapping providers again
means writing one new gateway, not touching business logic.

`CreemService` (`externals/services/creem.service.ts`) is the only file in
this module allowed to import the `creem` npm package. Its four methods —
`createCheckoutSession`, `getSubscription`, `cancelSubscription`,
`getCustomerBillingLink` — are the entire SDK surface the rest of the app
depends on. Signatures are pinned from the installed SDK in
[`docs/specs/creem-sdk-surface.md`](../../../docs/specs/creem-sdk-surface.md).

## Products, not variants

Creem sells products (`prod_*`), not the variant/SKU model LemonSqueezy used.
`subscription_plans.payment_gateway_product_id` holds the `prod_*` id.
`SubscriptionPlanService.findByProductId` resolves a plan from an inbound
webhook's `gatewayProductId`.

## API endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/subscriptions/plans` | JWT | List active subscription plans |
| GET | `/subscriptions/plans/:id` | JWT | Get a plan by id |
| POST | `/subscriptions/checkout` | JWT | Create a Creem checkout session |
| GET | `/subscriptions/subscriptions/:id` | JWT, owner-only | Get a subscription row by id |
| GET | `/subscriptions/user/subscriptions/:userId` | JWT, owner-only | List a user's subscriptions |
| DELETE | `/subscriptions/:id/cancel` | JWT, owner-only | Cancel a subscription (scheduled) |
| GET | `/subscriptions/payment-history` | JWT | Payment history for the caller |
| GET | `/subscriptions/user/payment-history/:userId` | JWT, owner-only | Payment history for a user |
| POST | `/subscriptions/payment-confirmation` | Public, signature-verified | Creem webhook ingress |

"Owner-only" means the endpoint takes a caller-supplied id and rejects with
403 if it does not belong to the authenticated caller.

### Create checkout session

```bash
POST /subscriptions/checkout
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "plan_id": "b3f1c2a0-...",
  "metadata": {
    "email": "user@example.com"
  }
}
```

Fails with 400 if the plan is inactive, or the user already has an active,
non-cancelled subscription. On success, Creem's checkout URL comes back
through `PaymentService.createCheckout` — see `CheckoutResponseDto`.

### Cancel a subscription

```bash
DELETE /subscriptions/:id/cancel
Authorization: Bearer <jwt_token>
```

## Cancellation is scheduled, not immediate

Cancelling calls Creem in `scheduled` mode. The local row gets
`is_cancelled = true` and `status = SCHEDULED_CANCEL`, but **`is_active` stays
true** — the user keeps access until the current period ends. Access is only
revoked when the `subscription.expired` webhook arrives
(`SubscriptionService.handleSubscriptionDeactivated`). There is no
"immediate" cancel path in this codebase today.

## Webhook flow

`POST /subscriptions/payment-confirmation` is `@Public()` and
internet-facing — signature verification is the entire security boundary
protecting it. `SubscriptionController.paymentConfirmation` runs, in order:

1. **Verify.** `PaymentService.verifyWebhookSignature(headers, rawBody)` —
   raw bytes only, never `JSON.stringify(payload)`. Any failure returns an
   identical generic 400 regardless of cause, so a bad signature and a
   missing header are indistinguishable to the caller.
2. **Parse.** `PaymentService.parseWebhook(payload)` never throws; an
   unrecognised event yields `PaymentEventType.UNKNOWN` rather than an
   exception.
3. **Resolve the user** from `event.metadata.user_id` (server-derived at
   checkout, trustworthy). Falls back to `event.customerEmail` only when
   `user_id` is absent, with a warning — `metadata.email` (client-supplied)
   is never read for entitlement.
4. **Resolve the plan once**, in the controller, and pass it through every
   call below.
5. **Claim.** `PaymentHistoryService.claimPaymentEvent` atomically
   reserves (or recognises as a duplicate) the `payment_history` row for
   `event.gatewayTransactionId`, before any handler runs.
6. **Route** on the normalized event type, then `markAsProcessed` only after
   the handler succeeds. An exception here leaves the claim unfinished, so
   Creem's retry legitimately reprocesses the event.

### Replay protection

The claim is one conditional `UPSERT` against
`payment_history.payment_gateway_transaction_id` (a `UNIQUE` constraint), gated
on `processing_claimed_at`/`processed_at`. A crashed handler's claim goes
stale after 2 minutes and can be legitimately reclaimed by Creem's next
retry. No DB transaction spans the claim and the handler — the handler calls
AWS SES, and holding a pooled connection across a network call would be false
atomicity.

### Two signature schemes

Creem signs webhooks under either a standard scheme (`webhook-id` /
`webhook-timestamp` / `webhook-signature`, HMAC-SHA256, 300s replay window) or
a legacy scheme (`creem-signature` / `x-creem-signature`, HMAC-SHA256, no
replay window). `CreemWebhookVerifier` selects a scheme deterministically —
partial standard headers are rejected outright, never treated as a signal to
fall back to the weaker legacy scheme. See
`externals/webhooks/creem-webhook-verifier.ts` for the exact algorithm.

## Test mode

Creem uses a different API host per mode, not a flag:
`https://api.creem.io` in production, `https://test-api.creem.io`
everywhere else. `CreemService` selects the host from `NODE_ENV`.

## Environment variables

```bash
CREEM_API_KEY=your_api_key
CREEM_WEBHOOK_SECRET=your_webhook_signing_secret
CREEM_FOUNDING_DISCOUNT_CODE=your_founding_rate_discount_code   # optional
```

## Related docs

- [`docs/specs/07-subscriptions-billing.md`](../../../docs/specs/07-subscriptions-billing.md) — intended business behavior and acceptance criteria
- [`docs/specs/10-founding-rate-lock-offer.md`](../../../docs/specs/10-founding-rate-lock-offer.md) — founding-rate discount behavior
- [`docs/specs/creem-sdk-surface.md`](../../../docs/specs/creem-sdk-surface.md) — pinned Creem SDK signatures
- [`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) — payment gateway abstraction and normalized webhook design
