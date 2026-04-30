---
doc_type: domain-spec
status: draft
owner: Fahad Subzwari
last_reviewed: 2026-04-28
---

# Beta Access (intended backend behavior)

> This spec describes **intended backend behavior** for the admin-issued beta invite system, code redemption, gated Pro access, and the expiry/downgrade lifecycle. It extends [07-subscriptions-billing.md](./07-subscriptions-billing.md) and [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md). The beta cohort grants `founding_rate_locked = true` but does **not** consume a `founding_slot_number` from the 1–100 cap.

## Business intent

Before Tailry publicly launches, invite a hand-selected cohort of beta testers to evaluate the product under real conditions. Each invitee receives a time-limited code that unlocks **30 days of Pro access** after redemption. When access expires, the user is downgraded automatically and offered the **Founding Rate ($7.20/mo)** as a post-beta conversion path — identical pricing to Founding slot holders but without consuming a numbered slot.

The goals are: (1) capture structured product feedback from motivated early users, (2) stress-test the billing and tailoring pipeline at low volume before public launch, and (3) seed a group of future paying customers with a meaningful discount anchor.

## Traceability

| ID | Kind |
|----|------|
| REQ-013 (new) | Functional — Beta invite issuance, code redemption, gated Pro access, expiry lifecycle |
| US-5 (new) | User story — beta tester redemption |
| REQ-010 | Functional — Founding Rate entitlement (pricing override reused for beta cohort) |
| REQ-007 | Functional — subscription and billing pipeline |
| NFR-SEC-02, NFR-REL-03, NFR-DATA-02 | Non-functional |

## Acceptance criteria

- [ ] **AC-BETA-01:** `POST /admin/beta/invite` accepts a batch of emails; for each new email it creates exactly one `BetaInvite` row with a valid `BETA-XXXXXXXX` code and enqueues a `beta_invite` email. Duplicate emails in the same request are rejected with `BETA_DUPLICATE_IN_REQUEST`. Emails already present in `beta_invites` are returned in `skipped` (idempotent — no second row, no second email).
- [ ] **AC-BETA-02:** Generated codes conform to the `BETA-XXXXXXXX` format: 7 Crockford base32 characters (alphabet excludes `0`, `O`, `1`, `I`, `L`, `U`) followed by 1 checksum character. Codes are cryptographically random and stored as plaintext; their SHA-256 digest is stored in the audit log only.
- [ ] **AC-BETA-03:** `code_expires_at` is set to `created_at + 7 days` (configurable per batch via `codeValidDays`). Redemption is rejected if `now > code_expires_at`.
- [ ] **AC-BETA-04:** `POST /beta/redeem` enforces **strict email match**: the `email` on the `BetaInvite` row must equal the authenticated user's account email (case-insensitive). Mismatches return `BETA_EMAIL_MISMATCH (403)`.
- [ ] **AC-BETA-05:** Redeem is transactional: the service acquires a row-level lock (`SELECT FOR UPDATE`) on the invite row, validates status and expiry, updates `BetaInvite` (status → `redeemed`, `redeemed_at`, `redeemed_by_user_id`, `pro_access_until = redeemed_at + access_days`), and updates the `User` row (`is_beta_user = true`, `beta_access_until = pro_access_until`, `founding_rate_locked = true`) atomically. No partial state is persisted on failure.
- [ ] **AC-BETA-06:** A code that has already been redeemed returns `BETA_CODE_ALREADY_REDEEMED (409)`. A revoked code returns `BETA_CODE_REVOKED (409)`. Neither leaks information about the invitee email.
- [ ] **AC-BETA-07:** `GET /beta/status` returns `is_beta_user`, `has_pending_redemption` (invite exists but not yet redeemed), `beta_access_until`, `days_remaining` (null if not active), `founding_rate_locked`, and — when `beta_access_until` is in the past and the user has not yet upgraded — a `post_expiry_offer` block with `{ monthly_price_usd: 7.20, discount_pct: 40 }`.
- [ ] **AC-BETA-08:** On new user registration, the auth pipeline checks `beta_invites` for a matching email. If a `pending` invite exists, `User.is_beta_user` is set to `true` at account creation time (signup auto-flip). The invite status remains `pending` until the user explicitly redeems their code.
- [ ] **AC-BETA-09:** `POST /admin/beta/revoke/:id` marks the invite `revoked`, records `revoked_at` and `revoked_reason`. When `revoke_active_access = true` it also clears `User.beta_access_until` (Pro entitlement removed immediately). `founding_rate_locked` is **not** cleared by revocation; that requires a separate admin audit action per [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md).
- [ ] **AC-BETA-10:** The daily cron `beta-expiry-sweep` (02:00 UTC) sends a T-3 reminder email to users whose `beta_access_until` falls within the next 3 days and who have not yet received one, downgrades users whose `beta_access_until < now` by nulling `User.beta_access_until` (Pro entitlement removed), and enqueues a `beta_ended_offer` email to each newly-downgraded user.
- [ ] **AC-BETA-11:** A second daily cron `beta-post-expiry-followup` (03:00 UTC) sends a `beta_post_expiry_followup` email to users who were downgraded 7 days ago and have still not started a paid subscription.
- [ ] **AC-BETA-12:** A third daily cron `beta-invite-cleanup` (04:00 UTC) transitions `pending` invites to `expired` where `code_expires_at < now`.
- [ ] **AC-BETA-13:** Redeem endpoint is rate-limited: 5 attempts per 10 minutes per authenticated user. Excess attempts return `BETA_RATE_LIMITED (429)`.
- [ ] **AC-BETA-14:** `GET /admin/beta/list` returns paginated invite rows filterable by `cohort` and `status`. PII (email) is returned only to callers in the `ADMIN_EMAILS` allowlist.
- [ ] **AC-BETA-15:** `is_beta_user` is sticky — it remains `true` even after `beta_access_until` expires or the invite is revoked. It is a permanent cohort membership marker, not a live entitlement flag. Live Pro entitlement is determined solely by `beta_access_until > now`.

## Data model

### New entity: `BetaInvite` → table `beta_invites`

| Field | Type | Notes |
|---|---|---|
| `id` | `uuid` pk | Internal identifier |
| `email` | `citext`, unique | Case-insensitive; matched against `User.email` at redeem |
| `code` | `varchar(16)`, unique | Format `BETA-XXXXXXXX` — 7 Crockford base32 chars + 1 checksum; see AC-BETA-02 |
| `code_expires_at` | `timestamptz` | `created_at + codeValidDays` (default 7 days) |
| `status` | `enum` | `pending`, `redeemed`, `expired`, `revoked` |
| `cohort` | `varchar(50)` | Default `wave-1`; set per batch at invite creation |
| `access_days` | `smallint` | Default `30`; configurable per batch via `accessDays` param |
| `redeemed_at` | `timestamptz \| null` | Set on successful redeem |
| `redeemed_by_user_id` | `uuid \| null`, fk → `users.id` ON DELETE SET NULL | Links invite to the user who redeemed it |
| `pro_access_until` | `timestamptz \| null` | Set on redeem: `redeemed_at + access_days` |
| `revoked_at` | `timestamptz \| null` | Set on admin revoke |
| `revoked_reason` | `varchar(200) \| null` | Required when status → `revoked` |
| `created_at` / `updated_at` | `timestamptz` | Standard |

**Indexes:**

- `UNIQUE (email)` — one invite per email address
- `UNIQUE (code)` — code lookup at redeem
- `INDEX (status, code_expires_at)` — expiry sweep query
- `INDEX (redeemed_by_user_id)` — reverse lookup from user

### User entity additions (3 new columns)

| Field | Type | Default | Notes |
|---|---|---|---|
| `is_beta_user` | `boolean` | `false` | Sticky cohort flag; stays `true` post-expiry |
| `beta_access_until` | `timestamptz \| null` | `null` | Live Pro entitlement window; nulled on downgrade |
| `founding_rate_locked` | `boolean` | `false` | Set `true` on redeem; survives downgrade; drives $7.20/mo checkout override |

> `founding_rate_locked` is shared with the Founding Rate Lock path (spec 10). Beta users receive the same checkout pricing override via this flag. `founding_slot_number` remains `null` for beta accounts — they are not Founding slot holders.

## API surface

All admin routes require the caller's email to be present in the `ADMIN_EMAILS` environment variable allowlist. All user routes require a valid JWT.

### Admin routes (prefix `/admin/beta`)

**`POST /admin/beta/invite`**

Creates one `BetaInvite` row per new email, enqueues `beta_invite` email per row. Idempotent per email.

Request body:
```json
{
  "emails": ["alice@example.com", "bob@example.com"],
  "cohort": "wave-1",
  "accessDays": 30,
  "codeValidDays": 7
}
```

Response `201`:
```json
{
  "created": [
    { "email": "alice@example.com", "code": "BETA-A2B3C4D5", "expires_at": "2026-05-05T00:00:00Z" }
  ],
  "skipped": [
    { "email": "bob@example.com", "reason": "already_invited" }
  ]
}
```

Error codes: `BETA_INVALID_EMAIL`, `BETA_DUPLICATE_IN_REQUEST`.

---

**`POST /admin/beta/revoke/:id`**

Revokes a single invite. When `revoke_active_access = true`, clears the linked user's `beta_access_until` immediately.

Request body:
```json
{
  "reason": "Fraud detected",
  "revoke_active_access": true
}
```

Response `200`:
```json
{ "ok": true, "invite_id": "uuid", "revoked_at": "2026-04-28T10:00:00Z" }
```

---

**`GET /admin/beta/list`**

Returns paginated invite rows.

Query params: `?cohort=wave-1&status=pending&page=1&limit=50`

Response `200`:
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "alice@example.com",
      "code": "BETA-A2B3C4D5",
      "status": "pending",
      "cohort": "wave-1",
      "access_days": 30,
      "code_expires_at": "2026-05-05T00:00:00Z",
      "redeemed_at": null,
      "pro_access_until": null
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 50
}
```

### User routes (prefix `/beta`)

**`POST /beta/redeem`**

Redeems a beta invite code for the authenticated user.

Request body:
```json
{ "code": "BETA-A2B3C4D5" }
```

Response `200`:
```json
{
  "ok": true,
  "pro_access_until": "2026-05-28T10:00:00Z",
  "days_remaining": 30,
  "founding_rate_locked": true
}
```

Error codes: `BETA_INVALID_CODE_FORMAT`, `BETA_CODE_NOT_FOUND`, `BETA_CODE_EXPIRED`, `BETA_CODE_ALREADY_REDEEMED`, `BETA_CODE_REVOKED`, `BETA_EMAIL_MISMATCH`, `BETA_RATE_LIMITED`.

---

**`GET /beta/status`**

Returns the caller's current beta entitlement snapshot.

Response `200`:
```json
{
  "is_beta_user": true,
  "has_pending_redemption": false,
  "beta_access_until": "2026-05-28T10:00:00Z",
  "days_remaining": 14,
  "founding_rate_locked": true,
  "post_expiry_offer": null
}
```

When `beta_access_until` is in the past and no active paid subscription:
```json
{
  "is_beta_user": true,
  "has_pending_redemption": false,
  "beta_access_until": "2026-04-20T10:00:00Z",
  "days_remaining": null,
  "founding_rate_locked": true,
  "post_expiry_offer": { "monthly_price_usd": 7.20, "discount_pct": 40 }
}
```

## Flows

### 1. Admin invite flow

```
Admin
  │  POST /admin/beta/invite { emails: [...], cohort, accessDays, codeValidDays }
  ▼
BetaAdminController.invite
  │  verify ADMIN_EMAILS allowlist
  │  validate email list (format, duplicates within request)
  │
  ▼
BetaService.bulkInvite
  │  for each email:
  │    SELECT from beta_invites WHERE email = ?
  │    → if found: push to skipped[]
  │    → if not found:
  │        generate code (Crockford base32 + checksum)
  │        set code_expires_at = now + codeValidDays
  │        INSERT BetaInvite (status=pending, cohort, access_days)
  │        push to created[]
  │        enqueue BetaInviteEmailJob(invite_id)
  │
  ▼
Response: { created: [...], skipped: [...] }
```

### 2. Signup auto-flip

```
User registers (POST /auth/signup or Google OAuth callback)
  │
  ▼
AuthService.createUser
  │  after user row is inserted:
  │    SELECT from beta_invites WHERE email = user.email AND status = 'pending'
  │    → if found: UPDATE users SET is_beta_user = true WHERE id = user.id
  │    (invite status remains 'pending' — not yet redeemed)
  │
  ▼
User row persisted with is_beta_user = true
```

### 3. Redeem flow

```
Authenticated user
  │  POST /beta/redeem { code: "BETA-A2B3C4D5" }
  ▼
BetaController.redeem
  │  check rate limit (5 / 10 min / user)
  │  validate code format (BETA- prefix + 8 chars)
  │
  ▼
BetaService.redeem  [DB transaction]
  │
  ├── SELECT * FROM beta_invites WHERE code = ? FOR UPDATE
  │     → not found → BETA_CODE_NOT_FOUND (404)
  │     → status = 'redeemed' → BETA_CODE_ALREADY_REDEEMED (409)
  │     → status = 'revoked'  → BETA_CODE_REVOKED (409)
  │     → status = 'expired' OR now > code_expires_at → BETA_CODE_EXPIRED (400)
  │
  ├── email match check
  │     invite.email ≠ user.email (citext) → BETA_EMAIL_MISMATCH (403)
  │
  ├── UPDATE beta_invites SET
  │     status = 'redeemed',
  │     redeemed_at = now,
  │     redeemed_by_user_id = user.id,
  │     pro_access_until = now + access_days
  │
  ├── UPDATE users SET
  │     is_beta_user = true,
  │     beta_access_until = pro_access_until,
  │     founding_rate_locked = true
  │
  ├── write audit log (actor=user, action=beta_redeemed,
  │     invite_id, code_sha256=sha256(code), timestamp)
  │
  └── enqueue BetaWelcomeEmailJob(user_id, invite_id)
  │
  ▼
Response: { ok: true, pro_access_until, days_remaining, founding_rate_locked }
```

### 4. Cron expiry flow

```
beta-expiry-sweep  (daily 02:00 UTC)
  │
  ├── T-3 reminder pass
  │     SELECT users WHERE beta_access_until BETWEEN now AND now+3d
  │       AND t3_reminder_sent = false      [or check audit log]
  │     for each: enqueue BetaExpiringSoonEmailJob(user_id)
  │
  ├── Downgrade pass
  │     SELECT users WHERE beta_access_until < now AND beta_access_until IS NOT NULL
  │     for each:
  │       UPDATE users SET beta_access_until = null
  │       enqueue BetaEndedOfferEmailJob(user_id)
  │       write audit log (action=beta_expired, user_id, timestamp)
  │
  └── (idempotent: re-run skips users already downgraded)

beta-post-expiry-followup  (daily 03:00 UTC)
  │
  └── SELECT users WHERE is_beta_user = true
        AND beta_access_until IS NULL
        AND no active paid subscription
        AND downgraded_at <= now - 7d
        AND followup_sent = false
      for each: enqueue BetaPostExpiryFollowupEmailJob(user_id)

beta-invite-cleanup  (daily 04:00 UTC)
  │
  └── UPDATE beta_invites SET status = 'expired'
        WHERE status = 'pending' AND code_expires_at < now
```

## Error codes

All codes are namespaced `BETA_*` and defined in `modules/beta-access/constants/error-codes.ts`. Follow the [09-api-conventions.md](./09-api-conventions.md) envelope.

| Code | HTTP | Meaning |
|---|---|---|
| `BETA_INVALID_EMAIL` | 400 | Email fails RFC/format validation |
| `BETA_DUPLICATE_IN_REQUEST` | 400 | Same email appears more than once in the `emails` array |
| `BETA_INVALID_CODE_FORMAT` | 400 | Code does not match `BETA-` prefix + 8-char pattern |
| `BETA_CODE_NOT_FOUND` | 404 | Code not present in `beta_invites` |
| `BETA_CODE_EXPIRED` | 400 | `now > code_expires_at` |
| `BETA_CODE_ALREADY_REDEEMED` | 409 | Invite status is `redeemed` |
| `BETA_CODE_REVOKED` | 409 | Invite status is `revoked` |
| `BETA_EMAIL_MISMATCH` | 403 | Authenticated user's email does not match the invite email |
| `BETA_NOT_AUTHENTICATED` | 401 | JWT missing or invalid on a protected route |
| `BETA_FORBIDDEN_ADMIN` | 403 | Caller email is not in `ADMIN_EMAILS` allowlist |
| `BETA_RATE_LIMITED` | 429 | Redeem rate limit exceeded (5 attempts / 10 min / user) |

## Email sequence

All emails are dispatched via Bull-backed queue jobs. Failed sends retry with exponential backoff (max 5 attempts). Brevo template IDs are injected via environment variables.

| Template key | Trigger | Recipient | Primary content |
|---|---|---|---|
| `beta_invite` | Admin issues invite | Invitee email | Code, expiry date, redemption instructions, product preview |
| `beta_redeemed_welcome` | Successful redeem | Redeemed user | Welcome message, Pro access end date, getting-started checklist |
| `beta_day_3_checkin` | T+3 after redeem | Redeemed user | Feedback prompt, highlight 2–3 key features, support link |
| `beta_expiring_soon` | T-3 before `beta_access_until` | Active beta user | Access expiry reminder, Founding Rate offer preview ($7.20/mo) |
| `beta_ended_offer` | Downgrade cron run | Newly downgraded user | Access ended notice, Founding Rate upgrade CTA ($7.20/mo), 40% off framing |
| `beta_post_expiry_followup` | T+7 post-downgrade, no upgrade | Downgraded non-subscriber | Final follow-up, feedback ask, Founding Rate offer reiterated |

### Environment variables for email templates

| Env var | Purpose |
|---|---|
| `BREVO_BETA_INVITE_TEMPLATE_ID` | `beta_invite` template |
| `BREVO_BETA_WELCOME_TEMPLATE_ID` | `beta_redeemed_welcome` template |
| `BREVO_BETA_DAY3_TEMPLATE_ID` | `beta_day_3_checkin` template |
| `BREVO_BETA_EXPIRING_TEMPLATE_ID` | `beta_expiring_soon` template |
| `BREVO_BETA_ENDED_TEMPLATE_ID` | `beta_ended_offer` template |
| `BREVO_BETA_FOLLOWUP_TEMPLATE_ID` | `beta_post_expiry_followup` template |

## Cron jobs

| Job name | Schedule (cron) | Responsibility |
|---|---|---|
| `beta-expiry-sweep` | `0 2 * * *` | T-3 reminder emails + downgrade expired users |
| `beta-post-expiry-followup` | `0 3 * * *` | T+7 post-downgrade follow-up for non-upgraders |
| `beta-invite-cleanup` | `0 4 * * *` | Transition `pending` invites past `code_expires_at` → `expired` |

## Security and audit

- **Admin allowlist:** All `/admin/beta/*` routes check the authenticated caller's email against the `ADMIN_EMAILS` environment variable before processing. There is no role column — the allowlist is the gate.
- **Code security:** Generated codes are stored in plaintext in `beta_invites.code` (needed for human-readable invite emails). The SHA-256 digest of each code is written to the audit log at issuance and at redeem — the plaintext code is never written to logs or the audit trail.
- **Row-level lock at redeem:** `SELECT ... FOR UPDATE` on the invite row prevents double-redemption under concurrent requests.
- **Rate limiting:** The redeem endpoint enforces 5 attempts per 10-minute window per authenticated user (via existing `rate-limit` module). This prevents brute-force code enumeration.
- **Strict email match:** Codes are non-transferable. Only the exact email address that received the invite may redeem it. Case-insensitive comparison via `citext`.
- **Idempotent redeem:** If the transaction commits successfully but the client times out, a retry of the same code returns `BETA_CODE_ALREADY_REDEEMED` — the user row is already updated, so the client can call `GET /beta/status` to confirm.
- **Audit log entries:** All writes to `BetaInvite.status`, `User.beta_access_until`, `User.founding_rate_locked`, and any admin revoke action are logged with actor, action key, affected entity id, and timestamp. Existing audit trail module conventions apply.
- **founding_rate_locked revocation:** Beta-triggered `founding_rate_locked = true` survives a beta access revocation. Removing the pricing flag requires a separate admin audit action, consistent with spec 10 policy.

## Module structure

New module `modules/beta-access/` mirroring existing module conventions:

```
modules/beta-access/
├── beta-access.module.ts
├── controllers/
│   ├── beta.controller.ts            # POST /beta/redeem, GET /beta/status
│   └── beta-admin.controller.ts      # POST /admin/beta/invite, POST /admin/beta/revoke/:id, GET /admin/beta/list
├── services/
│   ├── beta.service.ts               # redeem, status, signup auto-flip
│   └── beta-admin.service.ts         # bulkInvite, revoke, list
├── jobs/
│   ├── beta-invite-email.processor.ts
│   ├── beta-welcome-email.processor.ts
│   ├── beta-expiring-soon-email.processor.ts
│   ├── beta-ended-offer-email.processor.ts
│   └── beta-post-expiry-followup-email.processor.ts
├── crons/
│   ├── beta-expiry-sweep.cron.ts
│   ├── beta-post-expiry-followup.cron.ts
│   └── beta-invite-cleanup.cron.ts
├── guards/
│   └── admin-email-allowlist.guard.ts
├── dtos/
│   ├── bulk-invite.dto.ts
│   ├── redeem-beta-code.dto.ts
│   ├── revoke-beta-invite.dto.ts
│   ├── beta-status-response.dto.ts
│   └── bulk-invite-response.dto.ts
├── constants/
│   └── error-codes.ts
└── utils/
    └── beta-code.util.ts             # Crockford base32 generation + checksum
```

## Non-functional notes

- **Idempotency:** Bulk invite, redeem, and all cron passes are idempotent. Re-running the same operation produces the same observable state.
- **Atomicity:** The redeem transaction updates both `BetaInvite` and `User` in a single DB transaction. No partial state is observable on failure.
- **Concurrency:** Row-level lock at redeem prevents double-redemption under concurrent requests. Cron downgrade pass uses `WHERE beta_access_until < now AND beta_access_until IS NOT NULL` — safe for concurrent runs because `UPDATE ... SET beta_access_until = null` is idempotent.
- **Observability:** Emit metrics: `beta.invite.created`, `beta.invite.skipped`, `beta.redeem.success`, `beta.redeem.failed{reason}`, `beta.expiry.downgraded`, `beta.expiry.t3_reminder_sent`, `beta.followup.sent`, `beta.cleanup.expired`.
- **Scale:** Beta cohort is expected to be small (10–500 users). No special sharding or caching required. Admin list endpoint uses standard pagination.
- **founding_rate_locked and checkout:** Beta users flow through the same checkout pricing override as Founding slot holders (see [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md)). No separate pricing path is required.

## Out of scope

- Full Founding Rate Lock slot allocation (1–100 cap, `founding_slot_number` assignment, `founding_code` email flow, `founding_code_expiry` cron) — covered by [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md).
- Post-launch referral mechanics for beta cohort. Separate spec if/when built.
- Admin dashboard UI for invite management. CLI + database access is sufficient at beta scale.
- Unit tests for this scope (deferred).
- Transferring a beta invite between email addresses.
- Multiple concurrent beta invites for the same email (enforced by `UNIQUE(email)` on `beta_invites`).

## Related specs

- [10-founding-rate-lock-offer.md](./10-founding-rate-lock-offer.md) — `founding_rate_locked` flag and checkout pricing override reused by beta cohort
- [07-subscriptions-billing.md](./07-subscriptions-billing.md) — Pro entitlement activation and checkout flow
- [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md) — Pro plan limits applied during beta access window
- [11-waitlist-and-referral.md](./11-waitlist-and-referral.md) — parallel pre-launch acquisition channel; waitlist and beta are independent
- [02-auth-and-identity.md](./02-auth-and-identity.md) — user creation and signup auto-flip hook
- [09-api-conventions.md](./09-api-conventions.md) — error envelope, rate-limit guard conventions
- [functional-requirements.md](./functional-requirements.md) — REQ-013
- [non-functional-requirements.md](./non-functional-requirements.md) — NFR-SEC-02 (allowlist guard), NFR-REL-03 (queue retries), NFR-DATA-02 (PII handling)
