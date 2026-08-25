---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-22
---

# Founding Rate Lock — Launch offer (backend behavior)

> This spec describes **intended backend behavior** for the launch-time Founding Rate Lock offer. It extends [07-subscriptions-billing.md](./07-subscriptions-billing.md) and [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md). Marketing/landing-page content lives in `ats-fit-coming-soon-landing/docs/founding-rate-lock-offer.md`.

## Business intent

Grant the first **100 waitlist signups** a permanent **40% discount on Pro Monthly ($12 → $7.20/mo)**, honoured on every resumed subscription for the lifetime of the account. Redemption window is **7 days after launch (May 22, 2026)**. The rate reflects the episodic-use pattern of job-seeker tools: users pause between searches and resume months or years later at the same locked rate.

## Traceability

| ID | Kind |
|----|------|
| REQ-007 | Functional (extends subscriptions/billing) |
| REQ-010 (new) | Functional — Founding Rate Lock entitlement |
| US-4 | User story |
| NFR-SEC-02, NFR-DATA-02 | Non-functional |

## Acceptance criteria

- [ ] **AC-FRL-01:** A user account may carry a single **`founding_rate_locked`** flag set to `true` only if the user was assigned a Founding slot (1-100) via the waitlist import and redeemed within the 7-day window.
- [ ] **AC-FRL-02:** Exactly **100** Founding slots exist across all time. The service rejects any attempt to assign slot ≥ 101 with a structured error (`FOUNDING_TIER_FULL`).
- [ ] **AC-FRL-03:** Founding assignment is **immutable**: once set to `true`, it cannot be revoked programmatically except by an admin audit action (logged).
- [ ] **AC-FRL-04:** Every checkout for a Founding user against the Pro Monthly plan resolves to **$7.20/mo**, regardless of whether this is their first, second, or Nth subscription on the same account.
- [ ] **AC-FRL-05:** Cancelling and re-subscribing to Pro Monthly **preserves** the $7.20/mo rate (no reapplication of a coupon code required post-redemption).
- [ ] **AC-FRL-06:** Non-Founding users checking out Pro Monthly resolve to **$12/mo**, even if they somehow submit a Founding coupon code (coupon is validated against account flag, not code alone).
- [ ] **AC-FRL-07:** The redemption window is strictly enforced: first subscription activation must occur **within 7 × 24 hours** of launch timestamp. Outside this window, the Founding entitlement is **revoked** (flag → `false`, logged).
- [ ] **AC-FRL-08:** Founding users do not receive discounts on Pro Annual, batch-gen add-ons, or any future SKU unless explicitly extended by policy.
- [ ] **AC-FRL-09:** The public waitlist counter API returns **current signup count** (integer) without exposing emails or PII.

## Data model additions

Add to `User` entity (or equivalent auth/billing table):

| Field | Type | Notes |
|---|---|---|
| `founding_slot_number` | `integer \| null` | 1-100 if assigned; null otherwise. **Unique** (DB constraint). |
| `founding_rate_locked` | `boolean` | Default `false`. Set to `true` only after successful redemption. |
| `founding_code` | `string \| null` | Single-use redemption code emitted at launch email; nulled after redemption. |
| `founding_code_expires_at` | `timestamptz \| null` | Launch-timestamp + 7 days. |
| `founding_redeemed_at` | `timestamptz \| null` | Set on successful first Pro Monthly activation. |

Add to `SubscriptionPlan` configuration (or a new `price_override` table keyed by user):

- Founding price for Pro Monthly: **$7.20 USD**. Implemented via `CREEM_FOUNDING_DISCOUNT_CODE` — a Creem discount code applied at checkout when `user.founding_rate_locked = true` (`SubscriptionController.createPaymentCheckout`). A server-side price override remains the fallback design if the discount-code approach proves fragile, since it would survive Creem-side coupon expiry or changes without a code dependency.

## Flow (intended)

### Pre-launch: waitlist import

1. Ingest waitlist from Apps Script sheet into the backend (batch or on-demand).
2. Assign `founding_slot_number = row_index` for the first 100 rows. Emit `founding_code` per slot.
3. Store `founding_code_expires_at = launch_ts + 7 days`.
4. Send launch email (see comms spec in landing repo) with the code.

### Launch window: redemption

1. Authenticated user with valid `founding_code` initiates checkout for Pro Monthly.
2. `POST /subscriptions/checkout` detects `founding_code` in body/metadata:
   - Verify code matches `user.founding_code` AND `now < founding_code_expires_at` AND `user.founding_rate_locked = false`.
   - If valid: proceed to checkout at **$7.20/mo** (server-side price override).
   - On webhook `handleSuccessfulPayment`: set `founding_rate_locked = true`, `founding_redeemed_at = now`, null out `founding_code`.
3. Post-redemption subsequent checkouts: `founding_rate_locked = true` alone routes Pro Monthly to $7.20/mo (no code required).
4. Failed payment within window: `founding_code` remains valid; user may retry until `founding_code_expires_at`.

### Post-redemption: cancel/resume cycles

- User cancels Pro Monthly → subscription row transitions to `cancelled`; `founding_rate_locked` remains `true`.
- User resubscribes → checkout rebuilder sees `founding_rate_locked = true` → Pro Monthly priced at $7.20/mo. No manual code re-entry.

### Out of window: cleanup

- Nightly job: for users with `founding_code IS NOT NULL AND now > founding_code_expires_at AND founding_rate_locked = false` → null out `founding_code`, log as `FOUNDING_CODE_EXPIRED_UNREDEEMED`.
- Unredeemed slots do **not** free up for other users. Total Founding users ≤ 100 always.

## API surface (additions / changes)

- **`POST /subscriptions/checkout`** — extended DTO accepts optional `founding_code`. Error codes: `FOUNDING_CODE_INVALID`, `FOUNDING_CODE_EXPIRED`, `FOUNDING_ALREADY_REDEEMED`, `FOUNDING_TIER_FULL`.
- **`GET /waitlist/counter`** — **Public**. Returns `{ signups_count: number, founding_slots_remaining: number }`. No auth, short cache (60s) acceptable.
- **`GET /subscriptions/plans`** — when caller is authenticated and `founding_rate_locked = true`, return Pro Monthly with `display_price = 7.20` and `standard_price = 12.00` so UI can show the locked rate with strikethrough.

## Rate limits and entitlements

Founding users use the **same Pro entitlements** as standard Pro users (see [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md)). The discount is pricing-only, not feature-scope. This keeps the Pro tier consistent and prevents tier fragmentation.

## Security and audit

- Founding assignments (writes to `founding_slot_number`, `founding_rate_locked`) are **audit-logged** with actor (system/admin), timestamp, and reason.
- Admin-only override endpoint (if implemented) requires elevated role and writes to audit log.
- `founding_code` is treated as a secret — single-use, not logged in plaintext beyond the sent email.
- No bulk listing endpoint exposes Founding users to non-admin callers.

## Non-functional notes

- **Idempotency:** Webhook-driven `founding_rate_locked = true` transition must be idempotent against retried Creem webhooks — covered by the `payment_history` claim gate documented in [07-subscriptions-billing.md](./07-subscriptions-billing.md).
- **Atomicity:** Slot assignment (1-100) must be transactional — no two rows may claim the same `founding_slot_number`. Enforce via unique DB constraint + retry loop on collision.
- **Observability:** Emit metrics for `founding_slots_assigned`, `founding_codes_sent`, `founding_codes_redeemed`, `founding_codes_expired_unredeemed`.

## Beta cohort and founding_rate_locked

Beta testers (see [12-beta-access.md](./12-beta-access.md)) have `founding_rate_locked = true` set on code redemption. They do **not** consume a `founding_slot_number` from the 1–100 cap. The checkout pricing override (Pro Monthly → $7.20/mo) applies to beta-cohort users identically to Founding slot holders. `founding_slot_number` remains `null` for beta cohort accounts.

## Out of scope

- Refunds or retroactive Founding grants to post-launch signups.
- Transferring a Founding slot between accounts (explicitly disallowed).
- Applying the Founding discount to Pro Annual or future SKUs.
- Stacking the Founding rate with referral-program free-month bonuses on the **same** billing period (referral bonuses queue to the next billing period).

## Related specs

- Core subscription behaviour: [07-subscriptions-billing.md](./07-subscriptions-billing.md)
- Rate limits: [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md)
- Functional requirements: [functional-requirements.md](./functional-requirements.md)
- Business context (marketing side): `ats-fit-coming-soon-landing/docs/founding-rate-lock-offer.md`
- Frontend UX: `ats-fit-frontend/docs/specs/founding-rate-lock-offer.md`
