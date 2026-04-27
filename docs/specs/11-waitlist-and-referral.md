---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-24
---

# Waitlist and referral system (intended backend behavior)

> This spec describes **intended backend behavior** for the pre-launch waitlist, its referral loop, and the promotion of waitlist entries to `User` accounts at launch. It replaces the previous Apps Script + Google Sheet implementation documented in `ats-fit-coming-soon-landing/`. It is the **source of truth** for waitlist signup order, referral counts, bonus entitlements, and the Founding Rate Lock hand-off described in [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md).

## Business intent

Collect early-interest emails during the 30-day pre-launch window, measure and amplify virality through a referral loop, capture lightweight product-research signal (job-search status, biggest pain), and hand qualifying entries off to the auth/billing pipeline at launch with their **Founding slot** and **referral bonuses** preserved.

The waitlist is the **only** acquisition funnel for Founding Rate Lock entitlements (see [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md)). Signup order determines Founding slot 1–100; referrals unlock stackable bonuses but never alter that order.

## Traceability

| ID | Kind |
|----|------|
| REQ-011 (new) | Functional — Waitlist entry, referral capture, confirmation, launch promotion |
| REQ-012 (new) | Functional — Referral milestones, bonus entitlements, leaderboard |
| REQ-010 | Functional — Founding Rate entitlement (consumed at launch via waitlist → user promotion) |
| US-5 (new) | User story — "As a potential user, I want to join a waitlist and refer friends so I can secure early-access benefits." |
| NFR-SEC-02, NFR-DATA-02, NFR-REL-03 | Non-functional |

## Acceptance criteria

- [ ] **AC-WL-01:** A `POST /waitlist/signup` request with a valid email creates exactly one `WaitlistEntry` row and returns `{ ok: true, referral_code }`. Duplicate email submits are **idempotent** — they return `{ ok: true, duplicate: true, referral_code }` with the original code, no second row, no second confirmation email.
- [ ] **AC-WL-02:** Each `WaitlistEntry` is assigned a monotonically-increasing `signup_order` on insert. This value determines the Founding Rate slot eligibility at launch (first 100 confirmed entries).
- [ ] **AC-WL-03:** Every new entry emits a **confirmation email** via Brevo with a signed, single-use `confirm_token`. The entry is `email_confirmed = false` until the token is redeemed.
- [ ] **AC-WL-04:** A `GET /waitlist/confirm?token=...` call flips `email_confirmed = true`, clears the token, and redirects to `${LANDING_URL}/thanks?confirmed=true`. Reused or expired tokens redirect to `${LANDING_URL}/thanks?confirmed=already` without error.
- [ ] **AC-WL-05:** On successful confirmation, if `referred_by` is set and resolves to a confirmed referrer, the referrer's `referral_count` is atomically incremented and any newly-crossed reward thresholds append to `bonuses_unlocked` in the same transaction.
- [ ] **AC-WL-06:** Self-referral (same email or same `referral_code`) is rejected at signup with `SELF_REFERRAL_NOT_ALLOWED`. Cross-referral between two unconfirmed entries does **not** increment counts until both sides are confirmed.
- [ ] **AC-WL-07:** Referral count never increments from an unconfirmed referee. Reverting a confirmation (admin action) decrements the referrer's count and re-evaluates their bonuses (removing un-crossed thresholds).
- [ ] **AC-WL-08:** `GET /waitlist/count` returns `{ signups_count, founding_slots_remaining, confirmed_count }` cached at 60s. `signups_count` counts confirmed entries only to prevent inflated scarcity.
- [ ] **AC-WL-09:** `GET /waitlist/leaderboard` returns top 10 confirmed entries by `referral_count` (desc), tie-broken by `created_at` (asc). Response masks PII (e.g. `s***@g***.com`). Cached 60s.
- [ ] **AC-WL-10:** `GET /waitlist/stats?code=...` returns the caller's entry-specific status: `{ referral_code, referral_count, confirmed, next_threshold, bonuses_unlocked, signup_order }`. No auth required (code is capability). Rate-limited per IP.
- [ ] **AC-WL-11:** A **launch-day promotion job** (`WaitlistPromotionJob`) runs at the configured launch timestamp. For the first 100 `email_confirmed = true` entries ordered by `signup_order`, create or link a `User` row, set `founding_slot_number`, `founding_code`, and `founding_code_expires_at` per [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md). Apply `bonuses_unlocked` as non-pricing entitlements on the user's first Pro activation.
- [ ] **AC-WL-12:** Entries beyond slot 100 still receive a launch-day email (standard Pro $12/mo framing) on the same job run; they do **not** receive a Founding code.
- [ ] **AC-WL-13:** Disposable email domains (configurable blocklist) are rejected at signup with `DISPOSABLE_EMAIL_REJECTED`.
- [ ] **AC-WL-14:** IP-based rate limit applies: max 10 signup attempts per 10 min per IP, enforced via existing `rate-limit` module. Confirmation, stats, leaderboard endpoints have their own looser limits.
- [ ] **AC-WL-15:** All transactional emails are dispatched via a Bull-backed queue job, not inline. Failed sends retry with exponential backoff (max 5 attempts). Permanent failures are logged and surfaced to admin via metric.
- [ ] **AC-WL-16:** Brevo delivery webhook (`POST /waitlist/brevo-webhook`) is signature-verified and updates per-entry email-engagement metadata (`confirmation_delivered_at`, `bounced`, `spam_reported`). Required because waitlist signups without deliverable email are dead leads.

## Data model

### New entity: `WaitlistEntry`

Persisted in the same SQL database as `User`. Not merged into `User` — this is a **pre-user** record with a different lifecycle (most entries will never become users).

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` (pk) | Internal identifier |
| `email` | `citext`, unique | Case-insensitive unique index |
| `signup_order` | `bigint`, unique, auto-increment | DB sequence; determines Founding slot ordering |
| `referral_code` | `varchar(10)`, unique | 7-char base62 slug derived from `id`; URL-safe |
| `referred_by` | `varchar(10) \| null` | Points to another entry's `referral_code`; null if organic |
| `referral_count` | `int`, default `0` | Count of **confirmed** referees; atomic updates only |
| `email_confirmed` | `boolean`, default `false` | Flips true on confirmation-link click |
| `confirm_token` | `varchar(64) \| null` | HMAC-signed single-use token; cleared after use |
| `confirm_token_expires_at` | `timestamptz \| null` | `created_at + 14 days` (launch window safety) |
| `confirmed_at` | `timestamptz \| null` | Audit |
| `bonuses_unlocked` | `jsonb`, default `'[]'` | Array of unlocked reward keys (see below) |
| `job_search_status` | `varchar(20) \| null` | Optional enum: `active`, `passive`, `exploring` |
| `biggest_pain` | `varchar(40) \| null` | Optional enum: `tailoring_time`, `jd_match_confusion`, `losing_track`, `ats_rejection`, `other` |
| `signup_source` | `varchar(50)` | `hero`, `footer`, campaign tag, etc. Free-form but trimmed to 50. |
| `signup_ip` | `inet \| null` | For abuse analytics and rate-limit correlation; not shown in any API response |
| `signup_user_agent` | `varchar(255) \| null` | Same rationale |
| `brevo_message_id` | `varchar(128) \| null` | Set when confirmation email is dispatched, used to correlate webhook events |
| `confirmation_delivered_at` | `timestamptz \| null` | Set by Brevo webhook `delivered` event |
| `bounced` | `boolean`, default `false` | Set by Brevo webhook `hard_bounce` / `soft_bounce` |
| `spam_reported` | `boolean`, default `false` | Set by Brevo webhook `spam` |
| `user_id` | `uuid \| null`, fk → `users.id` | Set when `WaitlistPromotionJob` links this entry to a `User` at launch |
| `promoted_at` | `timestamptz \| null` | Audit of launch-day promotion |
| `created_at` / `updated_at` | `timestamptz` | Standard |

**Indexes:**

- `UNIQUE (email)` — prevent duplicates (case-insensitive via `citext`)
- `UNIQUE (referral_code)` — lookup performance + correctness
- `UNIQUE (signup_order)` — ordering integrity
- `INDEX (referred_by)` — referrer lookups
- `INDEX (email_confirmed, referral_count DESC)` — leaderboard query
- `INDEX (confirm_token)` where not null — confirmation path

### Bonus reward keys (`bonuses_unlocked` values)

Append-only JSON array. Each key unlocks at a referral threshold and is applied as an entitlement during launch-day promotion.

| Key | Threshold | Applied as |
|-----|-----------|------------|
| `credits_10_launch_month` | 1 | +10 one-off tailoring credits during launch month |
| `cover_letter_pack` | 3 | +10 cover-letter generations one-off; onboarding-call flag |
| `pro_month_free` | 5 | 1 month Pro free on first subscription (stacks on Founding Rate pricing) |
| `pro_annual_50_off` | 10 | One-time 50% off a Pro Annual subscription |
| `top_3_lifetime_pro` | Manual | Post-launch, top-3 leaderboard entries awarded lifetime Pro via admin action |

Entitlement application at launch happens via the `subscription` and `rate-limit` modules — waitlist never writes directly to those entitlement tables. The promotion job emits events, the consuming services grant.

## Email service (Brevo)

Brevo is the **sole** email provider for this module. Three use cases:

1. **Transactional (confirmation, milestone, launch-day code)** — sent via Brevo API with per-template IDs.
2. **Campaigns (pre-launch nurture sequence)** — list-based campaigns scheduled in Brevo UI. Backend syncs list membership only (add on confirm, remove on unsubscribe).
3. **Delivery event webhook** — Brevo posts `delivered` / `hard_bounce` / `spam` events back to `/waitlist/brevo-webhook`.

### Brevo configuration (env)

| Env var | Purpose |
|---|---|
| `BREVO_API_KEY` | Secret; scoped to transactional + contacts |
| `BREVO_WAITLIST_LIST_ID` | Contact list for campaigns; membership synced by backend |
| `BREVO_CONFIRMATION_TEMPLATE_ID` | Transactional template for confirmation email |
| `BREVO_MILESTONE_TEMPLATE_IDS` | JSON map of threshold → template id (e.g. `{"1":12,"3":13,...}`) |
| `BREVO_LAUNCH_FOUNDING_TEMPLATE_ID` | Launch-day email template for Founding-slot holders |
| `BREVO_LAUNCH_STANDARD_TEMPLATE_ID` | Launch-day email template for slot 101+ |
| `BREVO_WEBHOOK_SECRET` | Signing key for webhook verification |
| `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | Defaults `hello@atsfit.app` / `ATS Fit` |

### Why Brevo over SES (project decision)

- Built-in template editor with dynamic fields — no Handlebars rendering in backend.
- Native campaign + list management — the 3-touch pre-launch nurture sequence becomes a Brevo scheduled campaign, not a backend cron.
- Delivery webhook has a simple, documented shape.
- Free tier (300 emails/day, unlimited contacts) covers the 30-day waitlist window without a paid plan, unlike SES which requires domain sandbox exit + SES-specific infra.
- `@aws-sdk/client-ses` remains installed for `payment-failed.hbs` (existing path). Do **not** remove it. The two providers coexist: SES for internal transactional paths already wired, Brevo for waitlist-specific traffic. Consolidation is a post-launch decision.

## Module structure

New module `modules/waitlist/` mirroring existing module conventions:

```
modules/waitlist/
├── waitlist.module.ts
├── controllers/
│   └── waitlist.controller.ts        # POST /signup, GET /confirm, GET /count, GET /leaderboard, GET /stats
├── services/
│   ├── waitlist.service.ts           # core signup, confirmation, referral increment
│   ├── waitlist-promotion.service.ts # launch-day job body
│   └── referral.service.ts           # threshold evaluation, bonus unlock rules
├── externals/
│   ├── interfaces/
│   │   └── email-provider.interface.ts
│   └── services/
│       └── brevo.service.ts          # wraps Brevo API calls
├── jobs/
│   ├── confirmation-email.processor.ts
│   ├── milestone-email.processor.ts
│   ├── brevo-list-sync.processor.ts
│   └── waitlist-promotion.processor.ts
├── webhooks/
│   └── brevo-webhook.controller.ts   # POST /waitlist/brevo-webhook (Public + signature)
├── dtos/
│   ├── signup-waitlist.dto.ts
│   ├── waitlist-stats-response.dto.ts
│   ├── leaderboard-response.dto.ts
│   └── brevo-webhook.dto.ts
├── constants/
│   ├── reward-thresholds.constant.ts
│   ├── disposable-email-blocklist.constant.ts
│   └── error-codes.ts
└── utils/
    ├── referral-code.util.ts          # base62 slug generation
    └── email-mask.util.ts             # PII masking for leaderboard
```

Queue names follow existing `queue` module convention. Bull queue registrations live in `waitlist.module.ts` and are consumed by the global `QueueModule`.

## API surface (prefix `/waitlist`)

All routes are `@Public` unless noted. Secrets and rate limits are applied at the guard layer per [09-api-conventions.md](./09-api-conventions.md).

| Method | Path | Behavior | Auth | Rate limit |
|--------|------|----------|------|------------|
| `POST` | `/signup` | Create or idempotent-return waitlist entry | Public | 10 / 10 min per IP |
| `GET` | `/confirm` | Redeem `confirm_token`, redirect to landing `/thanks` | Public | 60 / 10 min per IP |
| `GET` | `/count` | `{ signups_count, founding_slots_remaining, confirmed_count }` | Public, 60s edge cache | 120 / min per IP |
| `GET` | `/leaderboard` | Top 10 masked entries by `referral_count` | Public, 60s edge cache | 120 / min per IP |
| `GET` | `/stats` | `?code=xxx` → entry's referral snapshot | Public (code-bearer) | 60 / min per IP |
| `POST` | `/brevo-webhook` | Brevo delivery events ingress | Public, signature-verified | — |
| `POST` | `/admin/promote` | Manually trigger promotion job (ops) | Admin JWT | — |
| `POST` | `/admin/revoke-confirmation/:id` | Admin-only confirmation revoke (fraud) | Admin JWT | — |

### Request shapes

**`POST /waitlist/signup`**

```json
{
  "email": "user@example.com",
  "referred_by": "abc1234",                // optional, from ?ref= URL param
  "job_search_status": "active",           // optional enum
  "biggest_pain": "tailoring_time",        // optional enum
  "signup_source": "hero",                 // e.g. "hero", "footer", "pl-hunt", "beta-list"
  "company": ""                             // honeypot; reject if non-empty
}
```

Response (success, new):
```json
{ "ok": true, "referral_code": "a1b2c3d", "confirmation_required": true }
```

Response (duplicate):
```json
{ "ok": true, "duplicate": true, "referral_code": "a1b2c3d", "confirmed": false }
```

Response (validation / rejection):
```json
{ "ok": false, "error": "DISPOSABLE_EMAIL_REJECTED" }
```

**`GET /waitlist/confirm?token=...`** — returns HTTP 302 redirect to `${LANDING_URL}/thanks?confirmed=<true|already|expired>`.

**`GET /waitlist/stats?code=...`**
```json
{
  "referral_code": "a1b2c3d",
  "signup_order": 47,
  "confirmed": true,
  "referral_count": 3,
  "bonuses_unlocked": ["credits_10_launch_month", "cover_letter_pack"],
  "next_threshold": { "key": "pro_month_free", "at": 5, "remaining": 2 }
}
```

**`GET /waitlist/leaderboard`**
```json
{
  "entries": [
    { "masked_email": "s***@g***.com", "referral_count": 12 },
    ...
  ],
  "generated_at": "2026-05-15T12:00:00Z"
}
```

### Error codes

Namespaced `WAITLIST_*` in `modules/waitlist/constants/error-codes.ts`. Follow [09-api-conventions.md](./09-api-conventions.md) envelope.

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_EMAIL` | 400 | Regex/RFC fail |
| `DISPOSABLE_EMAIL_REJECTED` | 400 | Domain on blocklist |
| `SELF_REFERRAL_NOT_ALLOWED` | 400 | Caller attempting to self-refer |
| `HONEYPOT_TRIGGERED` | 400 | `company` field non-empty |
| `INVALID_CONFIRM_TOKEN` | 400 | Token not found or malformed |
| `CONFIRM_TOKEN_EXPIRED` | 400 | Past `confirm_token_expires_at` |
| `RATE_LIMITED` | 429 | IP rate limit hit |
| `BREVO_SEND_FAILED` | 502 | Upstream email failure (surfaced only to admin/metric, not end-user) |

## Flows

### Signup flow

```
Client (landing page)
  │  POST /waitlist/signup
  ▼
WaitlistController.signup
  │  validate email, check honeypot, check disposable blocklist, check self-refer
  │
  ▼
WaitlistService.create
  │  transaction:
  │    - check by email → if exists, return existing entry (idempotent)
  │    - generate UUID, referral_code, confirm_token (HMAC)
  │    - insert WaitlistEntry (signup_order auto-incremented)
  │  enqueue ConfirmationEmailJob(entry_id)
  │  enqueue BrevoListSyncJob(entry_id, op='add')  [deferred until confirmed]
  │
  ▼
Response: { ok: true, referral_code }
```

### Confirmation + referral increment flow

```
Client (email link click)
  │  GET /waitlist/confirm?token=...
  ▼
WaitlistController.confirm
  │
  ▼
WaitlistService.confirm
  │  single transaction:
  │    1. find entry by confirm_token
  │    2. if not found → 302 /thanks?confirmed=expired
  │    3. if already confirmed → 302 /thanks?confirmed=already
  │    4. flip email_confirmed=true, confirmed_at=now, clear confirm_token
  │    5. if referred_by is set:
  │         a. find referrer by referral_code (must also be email_confirmed=true)
  │         b. if self-refer detected → skip (log)
  │         c. referrer.referral_count += 1 (row-locked UPDATE with returning)
  │         d. ReferralService.evaluateMilestones(referrer) → append new bonus keys
  │    6. enqueue MilestoneEmailJob(referrer_id) for each newly-unlocked bonus
  │    7. enqueue BrevoListSyncJob(entry_id, op='add')  [now move into campaign list]
  │  redirect 302 → ${LANDING_URL}/thanks?confirmed=true
```

### Launch-day promotion flow

Triggered by cron at launch timestamp (`LAUNCH_TS` env) or `POST /waitlist/admin/promote`:

```
WaitlistPromotionProcessor.run
  for each email_confirmed=true entry ordered by signup_order ASC:
    in transaction:
      - find or create User (by email)
      - if signup_order <= 100 AND no existing founding slot:
          - allocate next founding_slot_number (DB unique constraint)
          - generate founding_code, set founding_code_expires_at = LAUNCH_TS + 7 days
          - enqueue Launch-Day-Founding email via Brevo (template BREVO_LAUNCH_FOUNDING_TEMPLATE_ID)
      - else:
          - enqueue Launch-Day-Standard email via Brevo (template BREVO_LAUNCH_STANDARD_TEMPLATE_ID)
      - link entry.user_id = user.id; entry.promoted_at = now
    on User's first Pro activation, subscription module reads bonuses_unlocked
        via WaitlistEntry for that user_id and applies non-pricing entitlements.

  idempotent: re-running skips any entry where promoted_at is set.
  partial failure per entry is isolated — one bad row does not abort the batch.
```

### Brevo webhook flow

```
Brevo POST /waitlist/brevo-webhook
  │  verify signature (BREVO_WEBHOOK_SECRET)
  │  parse event
  │  for supported events (delivered, hard_bounce, soft_bounce, spam):
  │    locate entry by brevo_message_id (stored at dispatch time)
  │    update: confirmation_delivered_at | bounced=true | spam_reported=true
  │  respond 200 within 5s (Brevo requires ack)
```

## Referral rules (authoritative)

| Rule | Statement |
|---|---|
| **R1** | Signup order is independent of referrals. Founding slot = `signup_order` (first 100 confirmed). |
| **R2** | Referral count only increments when **both** the referrer and the newly-confirming referee are `email_confirmed = true`. |
| **R3** | A referrer who is not yet confirmed does **not** accrue counts; the accrual catches up on their own confirmation (evaluate pending at that moment). |
| **R4** | Self-referral (same email, same `referral_code`, same signup IP within a 10-min window) is detected and dropped silently from counts but stored for abuse analytics. |
| **R5** | Referral counts are monotonic under normal operation; only admin revoke (`/admin/revoke-confirmation/:id`) can decrement, and it re-evaluates bonus keys (removes keys whose threshold is no longer met). |
| **R6** | Top-3 leaderboard awards (`top_3_lifetime_pro`) are **not auto-granted**. An admin review step is required post-launch to mitigate gaming. |
| **R7** | Once promoted to `User`, referral counts freeze (no post-launch continued accrual from the waitlist system). |

## Security and audit

- `confirm_token` is generated via `crypto.randomBytes(32).toString('hex')`. Single-use; cleared after successful confirm.
- `confirm_token` has a **14-day expiry** to cover the full waitlist window plus launch; unredeemed entries past this stay in the table but cannot confirm and thus cannot accrue referrals or receive Founding slots.
- Brevo webhook signature verification is **required** in production; development falls back to a `BREVO_WEBHOOK_ALLOW_UNSIGNED=true` flag only. Default: reject unsigned.
- All writes to `referral_count`, `bonuses_unlocked`, `email_confirmed`, `founding_slot_number` (on related `User` row) are **audit-logged** (actor, timestamp, old/new, reason). Existing audit trail module convention applies.
- `signup_ip` and `signup_user_agent` are stored for abuse review only. Never returned in any public API response. Purge after 90 days post-launch.
- `WaitlistEntry.email` is treated as PII. GDPR delete requests wipe `email`, `signup_ip`, `signup_user_agent`, `confirm_token`, retain `signup_order` + `referral_count` (pseudonymized) for referral-integrity auditing.
- Disposable-email blocklist lives in `constants/disposable-email-blocklist.constant.ts`; sourced from `disposable-email-domains` npm package, updated on each deploy.

## Non-functional notes

- **Idempotency:** Signup, confirm, promotion, Brevo webhook are all idempotent. Re-POST of the same payload produces identical observable side-effects.
- **Atomicity:** Referral increment + bonus evaluation + milestone-email enqueue run in a single DB transaction. Milestone email job is enqueued *after* commit (outbox pattern not required at this scale — worst case is a duplicate email on crash, accept risk).
- **Concurrency:** `signup_order` relies on DB sequence — no app-level locking. Slot allocation at promotion uses `SELECT ... FOR UPDATE` on the promotion job's per-entry row.
- **Observability:** Metrics emitted: `waitlist.signup.total`, `waitlist.signup.duplicate`, `waitlist.signup.disposable_rejected`, `waitlist.confirm.success`, `waitlist.confirm.already`, `waitlist.confirm.expired`, `waitlist.referral.incremented`, `waitlist.bonus.unlocked{key}`, `waitlist.brevo.send.success`, `waitlist.brevo.send.failure`, `waitlist.brevo.webhook.{event}`, `waitlist.promotion.processed`, `waitlist.promotion.failed`.
- **Scale targets:** Pre-launch traffic estimated 500–2000 signups total across 30 days. Sizing headroom: module must handle 200 signups/hour without degradation (burst from Product Hunt launch amplification echoes).
- **Email volume budget:** Brevo free tier = 300/day. Expected peak day (launch T+0) ≈ 1200 emails (founding + standard to 500+ confirmed entries plus milestone trailing). Launch day requires a temporary Brevo paid plan upgrade — budget separately. Non-launch days stay under 100/day.

## Landing-page coordination

The `ats-fit-coming-soon-landing` static site calls this module directly (no Apps Script). Changes required there — referenced so implementation is synchronized:

- `index.html` — both `<form>` elements POST to `/api/waitlist` Cloudflare Function, which now forwards to `https://api.atsfit.app/waitlist/signup` (backend) instead of the Apps Script URL. Add hidden `<input name="referred_by">` populated from `?ref=` URL param.
- `thanks.html` — rebuilt to fetch `/api/waitlist/stats?code=<from sessionStorage>` and render referral link, progress bar, share buttons, leaderboard.
- `functions/api/waitlist/*` — CF Functions updated to forward to backend. `WAITLIST_GAS_URL` env var replaced with `WAITLIST_BACKEND_URL`.
- `apps-script/WaitlistWebApp.gs` — **deleted**. Existing sheet data (if any) must be exported and imported into `WaitlistEntry` via a one-shot migration script (`scripts/seed/seed-waitlist-from-csv.ts`). Signup-order from sheet row numbers is preserved to avoid losing early-signup goodwill.

Full frontend implementation plan lives at `ats-fit-coming-soon-landing/docs/landing-improvements-plan.md` — that doc must be updated in the same PR to reflect the backend target.

## Migration notes

- Section **"Pre-launch: waitlist import"** in [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md) previously described importing waitlist rows from an Apps Script sheet. That step is **superseded** by this spec — waitlist entries already live in the backend, so launch-day promotion is a local join instead of an external ETL. Update that section in the founding-rate spec when this one moves from `draft` to `approved`.
- The functional-requirements table (`functional-requirements.md`) needs two new rows: `REQ-011` (Waitlist + referral capture) and `REQ-012` (Referral milestones + bonus entitlements). Add in the same PR.

## Out of scope

- Post-launch referral mechanics (logged-in users inviting friends). Separate spec if/when built.
- Team / workspace waitlists. Single-user only.
- Transferring a referral code between accounts.
- Stacking multiple bonus keys of the same type on one account (e.g. two `pro_month_free` grants). Bonuses are evaluated as set-membership, not count.
- Paid Brevo-specific features (A/B splits, SMS). Email only.
- Admin dashboard UI for waitlist inspection. Sheet-level access via database + CLI scripts is sufficient until post-launch.

## Related specs

- [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md) — Founding Rate entitlement consumed by promotion job
- [07-subscriptions-billing.md](./07-subscriptions-billing.md) — how bonus entitlements are honored at Pro checkout
- [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md) — `credits_10_launch_month` and `cover_letter_pack` apply as one-off quota bumps
- [02-auth-and-identity.md](./02-auth-and-identity.md) — user creation side of launch-day promotion
- [09-api-conventions.md](./09-api-conventions.md) — error envelope, public-route conventions
- [functional-requirements.md](./functional-requirements.md) — REQ-011, REQ-012 to be added
- [non-functional-requirements.md](./non-functional-requirements.md) — NFR-SEC-02 (webhook signatures), NFR-REL-03 (queue retries), NFR-DATA-02 (PII handling)
- Landing repo: `ats-fit-coming-soon-landing/docs/landing-improvements-plan.md`
