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

## Amendments from Task 1 (SDK ground truth, verified)

`docs/specs/creem-sdk-surface.md` pins `creem@1.6.0`'s real surface; it supersedes any signature guessed elsewhere in this plan.

| Assumed in original plan | Actual (verified) |
|---|---|
| `new Creem({ serverURL })` | `new Creem({ apiKey, server: 'prod' \| 'test' })` — `serverIdx` does not exist |
| `createCheckout(...)` | `creem.checkouts.create(request, options?)` |
| `cancelSubscription(id)` | `creem.subscriptions.cancel(id, entity, options?)` — **second arg required** |
| `generateCustomerLinks(...)` | `creem.customers.generateBillingLinks(request, options?)` |
| single `creem-signature` header | **two** schemes; see below |

**Webhook verification decision (locked):** hand-roll both schemes in our own gateway. `import { verifyWebhookSignature } from 'creem/webhooks'` fails `TS2307` under this repo's `tsconfig.json` (no `moduleResolution` → Node10 classic, which ignores the package `exports` map), and bumping `moduleResolution` repo-wide is out of scope for a payments PR. We do not know which scheme the dashboard emits until Task 12, so support both and fail closed.

## Execution order (revised twice)

**`1, 2, 3, 4, 5, 6, 10, 9, 8, 7, 11, 12, 13`.** Task numbers are not renumbered — only the order changes.

Task 7 moves to **last** of the middle block because the adopted replay-dedup design makes the controller the orchestrator of everything beneath it: it needs `parseWebhook` (Task 6), the `payment_history` unique constraint (Task 10), `PaymentHistoryService` accepting a `NormalizedWebhookEvent` and reporting duplicates (Task 9), and `SubscriptionService`'s normalized handlers (Task 8). Wiring it before those exist would mean writing it twice.

Two hard dependencies force this:
1. Task 8 persists `SubscriptionStatus.SCHEDULED_CANCEL`, but `user_subscriptions.status` is a **Postgres enum type** (`user_subscriptions_status_enum`, values `active | cancelled | expired | paused | past_due`). Writing a value absent from that type is a runtime error, not a compile error. Task 10 must add the value first.
2. Task 9 calls `findByProductId`, which Task 10 creates.

## Decisions adopted after the Task 7 architecture consult

**1. Replay dedup — reuse `payment_history` as an atomic gate; no new table.**

Task 10 adds `UNIQUE (payment_gateway_transaction_id)` on `payment_history` (today it has neither a unique constraint nor an index, so the existing `findByExternalPaymentId` → `save` dedup is a read-then-write race). Task 7 then reorders so the history row is reserved *before* the state-changing handler runs:

```
verify -> parse -> resolve user/plan
  -> INSERT ... ON CONFLICT (payment_gateway_transaction_id) DO NOTHING
       inserted                      -> proceed
       conflict + processed_at SET   -> true duplicate: skip handler, return 200
       conflict + processed_at NULL  -> prior attempt died / Creem retry: proceed
  -> routeWebhookEvent
  -> markAsProcessed   (sets processed_at — the completion marker)
```

Dedup key is **`event.gatewayTransactionId`**, identical for both signature schemes — not the header-level `webhook-id`, which only the standard scheme sends. It lives inside the signed body, so it cannot be forged without breaking the HMAC, and a replay reuses it verbatim.

A legitimate Creem retry and a malicious replay are byte-identical; the only usable signal is our own completion state.

> **SUPERSEDED — the accepted race was wrong, and was proven so live.** The original text accepted double-processing on the grounds that "Creem's cadence is 30s/1m/5m/1h, not sub-second." That answers a different question than the code poses. Verified experimentally against Postgres 16: once the first delivery's reservation row is **committed** (which is exactly what this design does), a second delivery's `INSERT ... ON CONFLICT DO NOTHING` does **not** block — it returns `INSERT 0 0` immediately and reads `processed_at IS NULL`, so both deliveries run the handler. The race window is the handler's own execution time (tens–hundreds of ms, including an SES call), entirely independent of Creem's retry cadence, and deliberately reachable by double-firing a legacy-scheme replay (that scheme has no timestamp check). Consequence: double `upgradeToPremium`, duplicate emails.

**Replacement design (adopted):** add `payment_history.processing_claimed_at timestamp NULL` and make the reservation a single conditional UPSERT that atomically *claims* the row:

```sql
INSERT INTO payment_history (..., processing_claimed_at) VALUES (..., now())
ON CONFLICT (payment_gateway_transaction_id)
DO UPDATE SET processing_claimed_at = now()
WHERE payment_history.processed_at IS NULL
  AND (payment_history.processing_claimed_at IS NULL
       OR payment_history.processing_claimed_at < now() - interval '2 minutes')
RETURNING id;
```

`rows > 0` → we own this event, run the handler. `rows = 0` → already processed, or claimed by an in-flight attempt → skip the handler, return 200. The two-minute staleness window means a crashed handler's claim expires and Creem's next retry can legitimately reprocess, rather than the event being stuck forever. No held transactions, no row locks, no advisory locks (which would pin one of only ~10 pooled connections for the handler's full duration).

**`.orIgnore()` is banned.** TypeORM 0.3.28's `InsertQueryBuilder.orIgnore(statement)` coerces its argument to a boolean and discards it, always rendering an **unscoped** `ON CONFLICT DO NOTHING`. Harmless while this table has one unique constraint; silently wrong the day a second is added. Use `.onConflict('...')` or raw SQL, and detect insertion via `.returning([...])` + `result.raw.length > 0` — not `identifiers`/`generatedMaps`, which are populated by a separate path gated on `updateEntity`.

**2. Entitlement resolution — `metadata.user_id`, never `metadata.email`.**

```
user_id present  -> getUserById(user_id)
user_id absent   -> getUserByEmail(event.customerEmail)  + warn
neither resolves -> LOG ONLY, return 200. Do NOT insert payment_history.
```

> **Corrected.** An earlier version said "write `payment_history`, skip the handler, log error". That is **impossible**: `payment_history.user_id` is `NOT NULL` with an FK to `users`, so an insert with no resolved user can never succeed. Worse, the failed insert would return non-200 and Creem would retry an unfixable event on its full 30s/1m/5m/1h schedule forever. The unresolvable case must log at `error` (with `gatewayTransactionId`, `gatewayProductId`, `customerEmail`) and return 200. Do **not** make `user_id` nullable to accommodate this — degrading a financial audit table for a rare edge case is the wrong trade.

The fallback uses `event.customerEmail` (Creem's own record of who paid), **never** `metadata.email` (client-supplied, the source of the defect). Also cross-check `resolvedUser.email` against `event.customerEmail` and, on mismatch, log a warning and stash both in `payment_history.metadata` — **audit signal only, never a gate**, because paying with a work card while signed up personally is a legitimate mismatch.

`createCheckoutSession` is not modified; the now-unused `email` in `customData` is harmless once the webhook stops reading it for entitlement. `NormalizedWebhookEvent` needs no shape change.

## Task 9 binding requirements (Security + Architecture + DB consults)

**Money and trust**
1. `amount`/`currency` come **only** from the resolved `subscription_plans` row (`plan.price`, `plan.currency`). Never from `event.amountCents`/`event.currency` (both `undefined` by design) and never by digging into `event.raw`. If the plan does not resolve: `amount: 0` and log at **error**. A wrong-but-plausible amount silently corrupts revenue aggregates and is nearly undetectable; a `0` is greppable.
2. `payment_history.amount` is **list price, not charged price** — discounts and grandfathered pricing make them diverge. It is not a ledger. Creem is authoritative for disputes, refunds, and tax. Document this wherever the column is consumed.
3. Idempotency key is `event.gatewayTransactionId` — never `gatewaySubscriptionId` (renewals share it, so every renewal after the first would be swallowed) and never `eventId`.
4. `metadata.email` must not be read by this file for any lookup, ever. `setUserInformation`'s independent `customData.user_id` path must be deleted, not left as a second divergent implementation.
5. The email-mismatch signal is written to `metadata` as data. It must never gate or alter processing.

**Status and state**
6. `payment_history.status` **must be set explicitly** from `event.type` via an exhaustive `Record<PaymentEventType, PaymentStatus>` map. `markAsProcessed()` only sets `processed_at`; without an explicit status every row stays at the `'pending'` default forever, zeroing `getPaymentStats()`.
7. Never derive `payment_history.status` from `event.status` — that is a `SubscriptionStatus`, advisory, and may be `undefined`.
8. Never call `markAsProcessed()` before the handler has succeeded. Never swallow an exception between the claim and `markAsProcessed()` into a 200 — a wrong success means Creem stops retrying and the customer is never entitled.

**Shape and layering**
9. `paymentConfirmation` is renamed and returns a **discriminated union**, not a boolean — the controller must distinguish three states:
   `{ outcome: 'reserved' | 'retry' | 'duplicate'; row: PaymentHistory }`, in its own `interfaces/*.interface.ts` per `docs/CONVENTIONS.md`.
10. **Resolve the plan once, in the controller**, and pass it in. Task 7 and Task 9 currently each resolve it independently — two resolution paths for one event is a drift risk where routing and the persisted `subscription_plan_id` could disagree.
11. **No shared transaction** across claim → handler → `markAsProcessed`. The handler calls `upgradeToPremium` and AWS SES; wrapping an external network call in a DB transaction gives false atomicity (a rollback cannot un-send an email) and holds one of ~10 pooled connections for its duration. The claim UPSERT and `markAsProcessed` are each atomic on their own; the gap is exactly what the retry branch exists to handle.
12. Delete: `extractCustomData` (7 speculative JSON paths), `extractFailureReason` (zero callers), `validatePaymentGatewayData`, `checkExistingPayment` and the read-then-write dedup, and the `find*Safely` / `set*` helper chain. ~565 lines → ~150. Do **not** reimplement any of them against `event.raw`.
13. Keep `findByUserId` and `findByExternalPaymentId` untouched. Confirm `findBySubscriptionPlan` and `getPaymentStats` are genuinely uncalled before deleting. Do **not** split the class into read/write services in this PR.

**Schema**
14. `processing_claimed_at` goes in a **new, separate migration** — do not amend Task 10's migration, which is already reviewed and verified.
15. Correct `payment-history.entity.ts:16-17` to `@Index(['user_id','status'])` and `@Index(['subscription_plan_id','created_at'])`. The declared single-column indexes match only a fresh `InitialSchema` build; the live DB (and probably Railway) has the composites from the legacy lineage. Same drift class Task 10 fixed for the unique constraint. Left as-is, the next `migration:generate` proposes dropping the indexes actually serving these queries.

**Pre-existing IDOR — approved for fix in this task**
16. Add ownership checks to three endpoints in `subscription.controller.ts` that take a caller-supplied ID and never verify it, following the `ForbiddenException` pattern `cancelUserSubscription` already uses (`subscription.service.ts:417`):
    - `GET user/payment-history/:userId` (leaks `customer_email`, amounts, and the whole raw `payment_gateway_response`)
    - `GET user/subscriptions/:userId`
    - `GET subscriptions/:id` (compare the subscription's owner)
    Frontend impact is nil — it calls the authenticated-user-scoped `subscriptions/payment-history` and never the `:userId` variant, and passes its own id to `user/subscriptions`.

**Flagged, explicitly out of scope**
- No retention/deletion policy exists for `payment_history.payment_gateway_response`, which stores customer email and billing detail indefinitely. A GDPR erasure request could not be honoured today. Real gap; needs its own ticket.

## Working agreement (overrides the per-task steps below)

**No task commits its own work.** Implementers leave changes uncommitted in the working tree, stage nothing, and stop. The user reviews each task's diff and decides when it is committed. Any "Commit." step surviving below is superseded by this rule — Task 1 was the only task committed under the old arrangement.

## Build verification during the migration window (Tasks 2–10)

Task 1 removed `@lemonsqueezy/lemonsqueezy.js` while `src/main.ts` and `lemon_squeezy.service.ts` still import it, so **`npm run build` is expected to be red until Task 11 deletes those files.** The baseline is exactly two errors:

```
src/main.ts:17:35 - error TS2307: Cannot find module '@lemonsqueezy/lemonsqueezy.js'
src/modules/subscription/externals/services/lemon_squeezy.service.ts:9:8 - error TS2307: Cannot find module '@lemonsqueezy/lemonsqueezy.js'
```

Until Task 11, "the build passes" means **no errors other than those two**. Every task in this window verifies with:

```bash
npm run build 2>&1 | grep -E "error TS" | grep -v "@lemonsqueezy/lemonsqueezy.js"
```

Empty output = pass. Any line printed = a real regression you introduced. From Task 11 onward, the gate reverts to plain `npm run build` exiting 0.

**The Jest suite is already red on `master`, before any migration work.** Baseline measured at `a83b18d`: **5 failed suites / 11 failed tests / 113 passed**, in `rate-limit.service.spec.ts`, `user.service.spec.ts` (missing `BetaEntitlementService` in the test module), and three `resume-tailoring` specs. None are payment-related. So "tests pass" means **no more than that baseline** — Task 11's `npx jest` step must compare against 5/11, not against zero. Fixing those suites is out of scope for this migration.

## Architectural notes carried into the tasks

1. **`subscription.paid` fires on every renewal with the same subscription ID.** Idempotency must key on the *transaction* ID, not the subscription ID, or renewals after the first get silently swallowed.
2. **Creem keeps one subscription row across renewals; LemonSqueezy created a new one.** `replacement-quota.service.ts:203` explicitly relies on `starts_at` being the *current* period start. Under Creem, `starts_at` must be refreshed from `current_period_start_date` on every `subscription.paid`, otherwise the monthly replacement quota never resets.
3. **`subscription.scheduled_cancel` ≠ cancelled.** It must flag `is_cancelled` while leaving `is_active` true; the downgrade happens on `subscription.expired`.
4. **Pre-existing security bug fixed in-flight:** `subscription.service.ts:500` returns `true` when the signature header is absent, on a `@Public()` endpoint. Anyone can forge a payment event today.
5. **SDK surface is now pinned (Task 1 complete).** Published docs and the SDK README disagreed; `docs/specs/creem-sdk-surface.md` records the verified truth from `node_modules/creem@1.6.0` with file:line citations. `CreemService` remains the only file allowed to reference SDK symbols.

## Carry-forward constraints from Task 5

`CreemSubscription` (Task 5) makes two deliberate fail-safe choices that are correct for the **read** path but must NOT be copied into the **webhook** path:

1. **Unknown status → `EXPIRED`.** Safe when answering "what is this subscription?", dangerous when persisting. `CREEM_STATUS_MAP` is exported and Task 6 will reuse it, so if Task 8 derived `is_active` from the mapped status, a future Creem status this map hasn't caught up to would arrive on a `subscription.paid`, map to `EXPIRED`, and silently revoke a paying user's access. **Task 8 must derive `is_active` from the event *type* (`SUBSCRIPTION_ACTIVATED` / `SUBSCRIPTION_RENEWED` → active), never from the mapped status.**
2. **Missing period dates → epoch (`new Date(0)`).** An obviously-wrong sentinel is right for a non-persisted read model. In `parseWebhook`, `periodStart`/`periodEnd` are **optional** on `NormalizedWebhookEvent` — leave them `undefined` when Creem omits them. Persisting `1970-01-01` into `starts_at` would corrupt `ReplacementQuotaService`'s monthly window. Task 8's conditional spread (`...(event.periodStart ? {...} : {})`) already handles `undefined` correctly.

## Security controls for the webhook path (from Security Engineer consult)

`POST /api/v1/subscriptions/payment-confirmation` is `@Public()`, unauthenticated, internet-facing, and grants paid access. Binding requirements — each is a test case:

**Task 6 (verifier):**
1. No path returns `true` for a missing/empty signature or because of `NODE_ENV`. Ever.
2. Verification requires the raw body. **No `JSON.stringify(payload)` fallback** — if raw bytes are unavailable, fail closed. Re-serialised JSON is never byte-identical (key order, spacing, unicode escaping).
3. **Deterministic scheme selection, never "accept if either passes":** all three of `webhook-id`/`webhook-timestamp`/`webhook-signature` present as strings → standard scheme *only*; else `creem-signature`/`x-creem-signature` present as a string → legacy *only*; else reject. Partial standard headers = malformed = reject, never fall through to legacy (that fall-through is a downgrade oracle — legacy has no timestamp check).
4. Standard scheme: parse timestamp as int and reject when `|now - ts| > 300s` **before** comparing signatures.
5. Standard scheme strips `whsec_` then base64-decodes the secret exactly once; legacy uses the raw secret string, never decoded. Test that swapping the two derivations fails.
6. `webhook-signature` splits on whitespace into `version,sig` pairs; **only `v1` pairs are compared**; any v1 match accepts.
7. Legacy accepts `creem-signature` then `x-creem-signature`; strip a leading `sha256=` if present.
8. Comparison via `crypto.timingSafeEqual` on equal-length buffers only. Note `Buffer.from(s,'hex')` silently truncates on invalid hex rather than throwing — the length guard catches it, but test a garbage/odd-length value explicitly.
9. Any header value that is an array or non-string is treated as absent/invalid. Never `String()`/`.join()`/`[0]`-coerce.
10. No `catch` in the verify/parse path may resolve to "accepted".
11. Missing `CREEM_WEBHOOK_SECRET` → log and return `false`. It is not wired into config until Task 11, so between Tasks 6 and 11 this is the live runtime state; `undefined.startsWith(...)` must not throw inside a `@Public()` endpoint.
12. Never log the secret in any form, the computed digest, or the full signature header. Do log: scheme attempted, outcome, and a coarse reason category (`missing-headers` | `timestamp-expired` | `signature-mismatch` | `malformed-body`), plus `webhook-id` and event type.

**Task 7 (controller wiring):**
13. Signature check runs strictly before any DB read/write — preserve today's ordering.
14. **Every rejection returns the same 400 with a generic body.** Never vary status or message by failure reason (that is a forgery oracle), never echo `error?.message`. A non-200 is correct for genuine verification failures too — it lets Creem's 30s/1m/5m/1h retry schedule self-heal a misconfiguration.
15. **Resolve the entitled user from `metadata.user_id`, not `metadata.email`.** See the authorization gap below.

## Authorization gap found during the Task 6 security consult (fix in Task 7)

`subscription.controller.ts:206-213` builds checkout metadata as:
```ts
customData: {
  user_id: userId,                                  // server-derived from the JWT — trustworthy
  plan_id: subscriptionPlan.id,
  email: createSubscriptionDto.metadata?.email,     // straight from the client request body
}
```
and the webhook handler at `:627-646` then does `getUserByEmail(email)` — **using the client-controlled field while ignoring the server-derived one sitting next to it.** Whoever creates the checkout decides which account gets upgraded.

This is independent of signature verification: perfect HMAC on a payload whose entitlement key is attacker-chosen still grants the subscription to the wrong account. Fix in Task 7: resolve by `metadata.user_id` first, treat `email` as display data only. Keep an email fallback only with an explicit log, since a checkout created before this change would lack a usable `user_id`.

## Security requirements for Task 10 (from Security Engineer consult, verified)

1. **Duplicate pre-flight must live INSIDE `up()`**, as a `DO $$ ... RAISE EXCEPTION` guard on `SELECT ... GROUP BY payment_gateway_transaction_id HAVING COUNT(*) > 1`, not a manual runbook step. Railway runs migrations unattended in `preDeployCommand`; a silent constraint failure means new code ships against an old schema with nobody watching. **Abort on duplicates — never auto-deduplicate. This is payment data.**
2. **The constraint must be exactly `UNIQUE (payment_gateway_transaction_id)`** — single column, not partial, not expression-based, not multi-column. Postgres requires an exact match for `ON CONFLICT` inference; anything else makes Task 7's gate throw `42P10` on every delivery.
3. **No separate `CREATE INDEX`.** `ADD CONSTRAINT ... UNIQUE` implicitly creates the B-tree index that both the planner and `ON CONFLICT` use. A second index on the same column is pure duplication.
4. **Enum change uses the rename/recreate/cast swap, not `ALTER TYPE ... ADD VALUE`.** Not because of the transaction folklore — PG 12+ permits `ADD VALUE` in a transaction, and PG 16 is what we run — but because `ADD VALUE` has **no inverse**, so `down()` would be impossible. The new label list must be byte-identical to the old five plus `scheduled_cancel`; diff them character-for-character rather than eyeballing.
5. **`down()` must `RAISE EXCEPTION` if any row holds `status = 'scheduled_cancel'`.** Never auto-remap it. Coercing to `cancelled` revokes access from someone entitled to it; coercing to `active` hides a pending cancellation. Both are access-control changes nobody decided — a rollback must refuse and force a human call.
6. **Never set `migrationsTransactionMode` to `none`/`each`, and never pass a `--transaction` override.** Verified unset today, so TypeORM defaults to `"all"` and all four DDL statements are one atomic Postgres transaction. That is the safety net making partial application impossible.
7. **Exercise `migration:revert` twice locally** — once clean (must succeed), once with a manually inserted `scheduled_cancel` row (must fail per #5). The guard is otherwise untested.

**Rename blast radius — wider than the "Modify" list below.** Verified 11 source files reference `payment_gateway_variant_id` or `findByVariantId`: `subscription-plan.entity.ts`, `subscription.controller.ts`, `dtos/subscription-plan.dto.ts`, `examples/query-usage.examples.ts`, `interfaces/query.interface.ts`, `interfaces/subscription.interface.ts`, `services/payment-history.service.ts`, `services/subscription-plan.service.ts`, `utils/query-builder.util.ts`, `validators/subscription-plan.validator.ts`, and **both** seed files.

**`seed-subscription-plans.ts` is the live seed path** — imported by `seed-subscription-plans-standalone.ts` (what `npm run seed:subscription-plans` runs), `run-all-seeds-standalone.ts`, and `index.ts`. An earlier draft named only `seed-subscription-plans-service.ts`. Both need updating.

`utils/query-builder.util.ts` builds where-clauses dynamically, so a missed rename there fails silently at runtime rather than at compile time.

**Deployment red line (forward):** never ship this migration to Railway ahead of, or separately from, the code changes that consume the renamed column. `RENAME COLUMN` is atomic with no dual-name window; the currently-deployed code calls `findByVariantId` and would break the instant it commits. Schema and code ship in the same release.

**Deployment red line (reverse) — added after the Task 10 security review:** once Task 7 is live, **never `migration:revert` this migration against that database.** `down()` deliberately does not restore any unique constraint on `payment_history`, so reverting leaves Task 7's `INSERT ... ON CONFLICT (payment_gateway_transaction_id)` throwing `42P10` on *every* webhook delivery — the same outage the forward red line guards against, reached from the opposite direction. If a rollback is genuinely needed after Task 7 ships, roll back the application code first, or re-add the constraint by hand.

**Entity/DB sync:** `payment_history.payment_gateway_transaction_id` now carries `unique: true` in the entity. Without it, a future `migration:generate` diff sees the entity claiming no constraint while the DB has one, and proposes **dropping** `UQ_payment_history_gateway_transaction_id` — silently reopening webhook replay. Keep the decorator and the DB constraint in sync.

## File structure

**Create**
| Path | Responsibility |
|---|---|
| `src/modules/subscription/enums/payment-event-type.enum.ts` | Internal, provider-neutral webhook event types |
| `src/modules/subscription/externals/interfaces/normalized-webhook-event.interface.ts` | `NormalizedWebhookEvent` contract |
| `src/modules/subscription/externals/services/creem.service.ts` | Only file that imports the `creem` SDK |
| `src/modules/subscription/externals/gateways/creem-payment.gateway.ts` | `IPaymentGateway` impl: outbound calls + webhook parse/verify |
| `src/modules/subscription/externals/models/creem-subscription.model.ts` | Creem subscription object → `SubscriptionInfo` |
| `src/modules/subscription/externals/enums/creem-events.enum.ts` | Raw Creem `eventType` strings only — the `CreemEventType → PaymentEventType` table is parser-internal, not exported |
| `src/modules/subscription/externals/webhooks/creem-webhook-verifier.ts` | Two-scheme HMAC verification (static class, no DI) |
| `src/modules/subscription/externals/webhooks/creem-webhook-parser.ts` | Payload → `NormalizedWebhookEvent` (static class, no DI) |
| `src/modules/subscription/externals/utils/resolve-entity-id.util.ts` | Narrows Creem's `{id} \| string` relation unions |
| `src/database/migrations/<ts>-RenameVariantToProductAndAddCustomerId.ts` | Schema rename + new column |
| `src/modules/subscription/tests/creem-webhook.spec.ts` | Parse + verify unit tests |

**Delete**
`externals/services/lemon_squeezy.service.ts`, `externals/gateways/lemonsqueezy-payment.gateway.ts`, `externals/models/lemonsqueezy-subscription.model.ts`, `externals/enums/external-payment-gateway-events.enum.ts`, `dtos/payment-confirmation.dto.ts`, `dtos/create-subscription-from-payment-gateway.dto.ts`, `src/scripts/demonstrate-payment-switching.ts`, `debug-subscription-webhook.js`, dependency `@lemonsqueezy/lemonsqueezy.js`.

**Modify**
`subscription.controller.ts`, `services/subscription.service.ts`, `services/payment-history.service.ts`, `externals/interfaces/payment-gateway.interface.ts`, `externals/factories/payment-gateway.factory.ts`, `enums/payment-provider.enum.ts`, `enums/subscription-status.enum.ts`, `subscription.module.ts`, `shared/shared.module.ts`, `main.ts`, `config/configuration.ts`, `config/validation.schema.ts`, `database/entities/subscription-plan.entity.ts`, `database/entities/user-subscription.entity.ts`, `scripts/seed/seed-subscription-plans-service.ts`, `tests/payment-abstraction.spec.ts`.

---

### Task 1: Pin the Creem SDK and record its real surface — ✅ COMPLETE (`5bdbb0d`)

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
- [ ] **Step 4:** **Do not commit** — leave changes in the working tree for review.

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

- [ ] **Step 3:** Run the build gate → expect no new errors. **Do not commit.**

**verify:** `npm run build 2>&1 | grep -E "error TS" | grep -v "@lemonsqueezy/lemonsqueezy.js"` prints nothing (see "Build verification during the migration window").

---

### Task 3: Extend the gateway contract and status vocabulary

**path:** `src/modules/subscription/externals/interfaces/payment-gateway.interface.ts`, `src/modules/subscription/enums/payment-provider.enum.ts`, `src/modules/subscription/enums/subscription-status.enum.ts`
**intent:** Make webhook verify/parse first-class interface members and add the `CREEM` provider + `SCHEDULED_CANCEL` status.
**agency:** `Backend Architect` / `@agency-backend-architect.mdc`
**docs:** `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`

- [ ] **Step 1:** In `payment-gateway.interface.ts`, make verification required and add parsing:

```ts
/** Subset of incoming request headers needed for signature verification. */
export type WebhookHeaders = Record<string, string | string[] | undefined>;

  /** Verify webhook authenticity from the request headers + raw body. */
  verifyWebhookSignature(headers: WebhookHeaders, rawBody: string): boolean;

  /** Translate a provider webhook payload into the internal event shape. */
  parseWebhook(rawPayload: unknown): NormalizedWebhookEvent;
```

Creem supports two signature schemes keyed off *different* headers, so the whole header bag must be passed — a single `signature: string` parameter cannot express this. Update `PaymentService.verifyWebhookSignature` (`src/shared/services/payment.service.ts:154`) to the same shape, and drop its `return true` fallback for gateways that don't implement verification — verification is now a required interface member.

- [ ] **Step 2:** Add `CREEM = 'creem'` to `PaymentProvider`.
- [ ] **Step 3:** Add `SCHEDULED_CANCEL = 'scheduled_cancel'` to `SubscriptionStatus`. **This is a TypeScript-only change here.** `user_subscriptions.status` is a Postgres enum type that does not yet contain this value — Task 10 adds it via `ALTER TYPE`. Nothing may *persist* this status until Task 10 has run; Task 5 only returns it from a read path, which is safe.
- [ ] **Step 4:** `npm run build` — expect it to FAIL, pointing at `LemonSqueezyPaymentGateway` (missing `parseWebhook`). This is the intended signal that the old adapter is now non-conforming; it is deleted in Task 11. Leave it broken and continue, or stub `parseWebhook` to `throw new Error('removed')` to keep the build green between tasks.
- [ ] **Step 5:** **Do not commit** — leave changes in the working tree for review.

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
this.client = new Creem({
  apiKey: this.configService.get<string>('CREEM_API_KEY'),
  server: isProd ? 'prod' : 'test',
});
```

`server` is a named key (`'prod' | 'test'`), verified at `node_modules/creem/dist/commonjs/lib/config.d.ts:25`. There is no `serverIdx`. Passing `server` is preferred over a raw `serverURL` so the host mapping stays the SDK's problem.

- [ ] **Step 2:** Expose exactly four methods, each translating SDK errors into the repo's `custom-http-exceptions` per `docs/ERROR-HANDLING.md`:
  - `createCheckoutSession({ productId, email, metadata, discountCode, successUrl })`
  - `getSubscription(subscriptionId)`
  - `cancelSubscription(subscriptionId, mode: 'scheduled' | 'immediate')`
  - `getCustomerBillingLink(customerId)`
- [ ] **Step 3:** Build the success URL exactly as the old service did (`SUBSCRIPTION_SUCCESS_URL` + `?payment=success`) so the frontend's existing `?payment=success` check keeps working — Creem appends its own params additively.
- [ ] **Step 4:** Run the build gate. **Do not commit.**

**verify:** `npm run build 2>&1 | grep -E "error TS" | grep -v "@lemonsqueezy/lemonsqueezy.js"` prints nothing; `grep -rn "from 'creem'" src/` returns only `creem.service.ts`.

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

- [ ] **Step 2:** Implement the gateway. `createCheckout` maps `variantId → productId`, `customData → metadata`, `discountCode → discountCode`. `cancelSubscription` calls `creem.subscriptions.cancel(id, { mode: 'scheduled' })` — the second argument is **required** (`node_modules/creem/dist/commonjs/sdk/subscriptions.d.ts:28`), so omitting it is a type error, not a default. `createCustomerPortal` calls the billing-link method.
- [ ] **Step 3:** Keep `getCustomerSubscriptions` returning `[]` with a warn log — it is unused today and out of scope.
- [ ] **Step 4:** Run the build gate. **Do not commit.**

**verify:** `npm run build 2>&1 | grep -E "error TS" | grep -v "@lemonsqueezy/lemonsqueezy.js"` prints nothing (see "Build verification during the migration window").

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
  - a body signed under the standard-webhook scheme verifies, and one with a timestamp older than 300s is rejected as a replay;
  - a request carrying neither `webhook-signature` nor `creem-signature` is rejected;
  - `subscription.paid` parses to `SUBSCRIPTION_RENEWED` with `gatewayTransactionId` from `object.last_transaction_id`;
  - `checkout.completed` reads the subscription ID from `object.subscription.id`;
  - `subscription.scheduled_cancel` parses to `SUBSCRIPTION_CANCEL_SCHEDULED`, not `SUBSCRIPTION_CANCELLED`;
  - an unrecognised `eventType` yields `PaymentEventType.UNKNOWN` and never throws.

- [ ] **Step 2: Run and confirm failure** — `npx jest src/modules/subscription/tests/creem-webhook.spec.ts` → FAIL.

- [ ] **Step 3: Implement `verifyWebhookSignature(headers, rawBody)` supporting both Creem schemes**, selected by which header is present. Algorithms are documented in `docs/specs/creem-sdk-surface.md` (read off the SDK's compiled `webhooks.js`); do not invent them:

  - **Standard-webhook scheme** — headers `webhook-id`, `webhook-timestamp`, `webhook-signature`. Strip the `whsec_` prefix from the secret and base64-decode it; sign `` `${id}.${timestamp}.${rawBody}` `` with HMAC-SHA256; compare base64, accounting for the space-delimited, version-tagged (`v1,<sig>`) header format. Reject when `|now - timestamp| > 300s` (replay window).
  - **Legacy scheme** — header `creem-signature` or `x-creem-signature`. HMAC-SHA256 of the raw body with the raw secret, compared as hex.
  - **Neither header present → reject.** No environment escape hatch, no empty-signature pass.
  - Use `crypto.timingSafeEqual` inside a length guard on both paths.

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

Field extraction — **corrected against the actual SDK `.d.ts`; an earlier draft of this list was wrong and incomplete**:

| Field | Source |
|---|---|
| `gatewaySubscriptionId` | `rawType.startsWith('subscription.')` → `object.id`; otherwise `object.subscription` (a `SubscriptionEntity \| string \| undefined` union — narrow it). **`refund.created` and `dispute.created` nest it the same way `checkout.completed` does**, verified in `refundentity.d.ts:72` and `disputeentity.d.ts:62`. |
| `gatewayTransactionId` | `object.lastTransactionId ?? object.transaction?.id ?? object.order?.id ?? envelope.id`. The `transaction` term is required — `RefundEntity`/`DisputeEntity` have no `lastTransactionId`, they carry a required `transaction: TransactionEntity` (`refundentity.d.ts:60`, `disputeentity.d.ts:50`). |
| `gatewayProductId` | `object.product` narrowed (`ProductEntity \| string`), `undefined` when absent. **Task 9 depends on this for `findByProductId`** and an earlier draft omitted it entirely. Note `WebhookSubscriptionEntity.product` is a required non-union `ProductEntity` (`:57`), while `SubscriptionEntity.product` is the union — handle both. Refund/dispute objects have no product; `undefined` is correct there. |
| `isTestMode` | `object.mode !== 'prod'`. Every webhook object carries `mode: 'test' \| 'prod' \| 'sandbox'` (`environmentmode.d.ts`). Treat `sandbox` **and any unrecognised future value** as test-like, so an ambiguous event is never mistaken for a real payment. This field is required on `NormalizedWebhookEvent` and had no extraction rule at all in an earlier draft. |
| `status` | `CREEM_STATUS_MAP[object.status]` — **without** the `?? SubscriptionStatus.EXPIRED` fallback. `NormalizedWebhookEvent.status` is optional, so `undefined` is the correct, type-safe result for an unmapped status. Reusing the map keeps one vocabulary; dropping the fallback makes the dangerous path structurally impossible instead of merely documented. `creem-payment.gateway.ts` uses the fallback correctly one scroll away in `buildCancelSubscriptionResponse` — do not copy that line. |
| `metadata` | `object.metadata ?? {}` |
| `customerEmail` | `object.customer?.email` (narrow the `CustomerEntity \| string` union) |
| `cancelledAt` | `object.canceledAt` (one `l`), `undefined` when absent |
| `periodStart` / `periodEnd` | `object.currentPeriodStartDate` / `currentPeriodEndDate`. **Leave `undefined` when absent — never the epoch fallback used by `CreemSubscription`** (see carry-forward constraints). |

Entity-id narrowing (`{id} | string`) is needed in four places here plus `creem-subscription.model.ts`; extract it once as `externals/utils/resolve-entity-id.util.ts` rather than duplicating the ternary.

- [ ] **Step 5: Run tests** → PASS. **Do not commit.**

**verify:** `npx jest src/modules/subscription/tests/creem-webhook.spec.ts` — all pass, including the empty-signature rejection.

---

### Task 7: Rewire the webhook controller

**path:** `src/modules/subscription/controllers/subscription.controller.ts:594-725`
**intent:** Replace the LS-shaped ingress with verify → parse → route on normalized events, and close the signature bypass.
**agency:** `Security Engineer` / `@agency-security-engineer.mdc`
**docs:** `docs/SECURITY.md`, `docs/API-PATTERNS.md`

- [ ] **Step 1:** Change the handler signature: take the whole header bag via `@Headers() headers: WebhookHeaders` (not a single named header — scheme selection needs all of them), accept the body as `unknown` (drop `PaymentConfirmationDto`), keep `RawBodyRequest`.
- [ ] **Step 2:** Verify via `this.paymentService.verifyWebhookSignature(headers, req.rawBody.toString('utf8'))` and reject with 400 before any state mutation. If `req.rawBody` is absent, reject — never fall back to `JSON.stringify(payload)`, which does not round-trip byte-for-byte.
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
- [ ] **Step 6:** Run the build gate and `npm run lint`. **Do not commit.**

**verify:** `npm run build 2>&1 | grep -E "error TS" | grep -v "@lemonsqueezy/lemonsqueezy.js"` prints nothing; `grep -n "x-signature\|PaymentConfirmationDto" src/modules/subscription/controllers/subscription.controller.ts` returns nothing.

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
  status: this.eventTypeToPersistedStatus(event.type),
  is_active: ACTIVATING_EVENT_TYPES.has(event.type),
  ...(event.periodStart ? { starts_at: event.periodStart } : {}),
  ...(event.periodEnd ? { ends_at: event.periodEnd } : {}),
});
```

**Do NOT write `is_active: event.status === SubscriptionStatus.ACTIVE`.** An earlier draft of this plan did, contradicting the carry-forward constraint above. `event.status` is advisory and may be `undefined` for an unmapped Creem status; deriving activeness from it means a future Creem status arriving on a `subscription.paid` silently revokes a paying user. Both `status` and `is_active` must come from `event.type`, via a `PaymentEventType → SubscriptionStatus` mapping owned by `SubscriptionService` (the persistence boundary).

Without this, `ReplacementQuotaService.resolveMonthlyWindow` (`replacement-quota.service.ts:203`) keeps anchoring on the original signup date and the monthly replacement quota never resets — LemonSqueezy created a fresh row per renewal, Creem does not.

- [ ] **Step 4:** Add `handleCancellationScheduled(event, user)`: set `is_cancelled = true`, `cancelled_at = now`, `status = SCHEDULED_CANCEL`, and **leave `is_active` true** — no `downgradeToFreemium()` call.
- [ ] **Step 5:** In `cancelUserSubscription` (`:411-462`), stop downgrading immediately. Call the gateway (scheduled), then set `is_cancelled = true` / `cancelled_at` / `status = SCHEDULED_CANCEL`, keep `is_active` true, and return. The downgrade now happens only via the `subscription.expired` webhook.
- [ ] **Step 6:** Run the build gate. **Do not commit.**

**verify:** `npm run build 2>&1 | grep -E "error TS" | grep -v "@lemonsqueezy/lemonsqueezy.js"` prints nothing; `grep -n "LEMON_SQUEEZY\|lemonSqueezy" src/modules/subscription/services/subscription.service.ts` returns nothing.

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
- [ ] **Step 6:** **Source `amount`/`currency` from the local `subscription_plans` row, not the webhook payload.** Task 6 left `NormalizedWebhookEvent.amountCents`/`currency` `undefined`: Creem's webhook objects do not reliably carry price inline (the product relation is often an unexpanded ID string), and the Task 6 implementer correctly declined to invent an extraction rule. Once the plan is resolved above, read `plan.price` and `plan.currency` from our own database — that is authoritative, already seeded per plan, and avoids trusting money amounts from a payload. If no plan resolves, record the payment with `amount: 0` and log a warning rather than guessing.
- [ ] **Step 6:** Run the build gate. **Do not commit.**

**verify:** `npm run build 2>&1 | grep -E "error TS" | grep -v "@lemonsqueezy/lemonsqueezy.js"` prints nothing; `grep -n "data?.attributes" src/modules/subscription/services/payment-history.service.ts` returns nothing.

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
ALTER TABLE "payment_history" ADD CONSTRAINT "UQ_payment_history_gateway_transaction_id" UNIQUE ("payment_gateway_transaction_id");
-- plus: add 'scheduled_cancel' to user_subscriptions_status_enum (see below)
```

The `payment_history` unique constraint is what makes Task 7's replay gate atomic — see "Decisions adopted". Check for pre-existing duplicate `payment_gateway_transaction_id` values before adding it; with zero paying customers there should be none, but a beta/test row could block the migration.

**The enum change needs care.** `user_subscriptions.status` is the Postgres enum `user_subscriptions_status_enum('active','cancelled','expired','paused','past_due')`. Task 3 added `SCHEDULED_CANCEL = 'scheduled_cancel'` on the TypeScript side; without the matching database value, Task 8's cancellation path fails at runtime.

`ALTER TYPE ... ADD VALUE` has transaction restrictions and TypeORM wraps migrations in a transaction, so prefer the transaction-safe type-swap:

```sql
ALTER TYPE "user_subscriptions_status_enum" RENAME TO "user_subscriptions_status_enum_old";
CREATE TYPE "user_subscriptions_status_enum" AS ENUM('active','cancelled','expired','paused','past_due','scheduled_cancel');
ALTER TABLE "user_subscriptions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "user_subscriptions" ALTER COLUMN "status" TYPE "user_subscriptions_status_enum" USING "status"::text::"user_subscriptions_status_enum";
ALTER TABLE "user_subscriptions" ALTER COLUMN "status" SET DEFAULT 'active';
DROP TYPE "user_subscriptions_status_enum_old";
```

If `ALTER TYPE ... ADD VALUE` proves to work cleanly on the target Postgres version, that is acceptable too — but verify it actually runs inside TypeORM's transaction rather than assuming.

Include a symmetric `down()`. The unique index on the renamed column is carried by `RENAME COLUMN` — confirm with `\d subscription_plans` after running.

- [ ] **Step 2:** Rename the entity property in `subscription-plan.entity.ts:33-34`; add the new column to `user-subscription.entity.ts`.
- [ ] **Step 3:** Rename `SubscriptionPlanService.findByVariantId` → `findByProductId` and update its two call sites (`payment-history.service.ts`, `subscription.controller.ts:206`).
- [ ] **Step 4:** Populate `payment_gateway_customer_id` from `event.gatewayCustomerId` in the Task 8 create/update paths.
- [ ] **Step 5:** Run `npm run migration:run` against local Postgres.
- [ ] **Step 6:** **Do not commit** — leave changes in the working tree for review.

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
- [ ] **Step 9:** `npm run build` exits 0 and `npm run lint` is clean (the plain build gate applies from here on). `npx jest` must show **no worse than the recorded baseline of 5 failed suites / 11 failed tests**, and every payment/subscription suite must pass. **Do not commit.**

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
- [ ] **Step 6:** Record the results for the PR description. **Do not commit** the seed change — leave it for review.

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
- [ ] **Step 4:** **Do not commit** — leave changes in the working tree for review.

**verify:** `grep -rni "lemon" docs/ src/modules/subscription/README.md` returns only entries in `docs/superpowers/` history and this plan file.

---

## Out of scope

- Migrating existing subscriptions (there are none).
- Verifying Creem's redirect `signature` query param on the success URL — the webhook is the source of truth; worth a follow-up ticket.
- `getCustomerSubscriptions()` — still a stub, unused.
- One-time payments, licence keys, affiliates.
