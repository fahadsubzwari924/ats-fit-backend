---
doc_type: compliance-reference
status: draft
owner: TBD
last_reviewed: 2026-08-24
---

# GDPR readiness

> Engineering and compliance-readiness guidance from three specialist consults (Legal Compliance, Security Engineering, Software Architecture) reviewing this codebase. **Not legal advice** — several findings below explicitly need lawyer confirmation. Use it to prioritize engineering work, not as a compliance certification.

## Status / scope

ATS Fit / Tairly: solo-dev SaaS, beta, **zero paying customers**, migrating payments from LemonSqueezy to Creem. NestJS + TypeORM + Postgres 16 on Railway. Reviewed 2026-08-24.

**Risk today is low, not zero.** GDPR applies to EU personal data regardless of revenue. Nothing here says a regulator is coming — the real cost of ignoring this is debt: every new user and every new table makes the eventual fix bigger. Deadlines below ("before first paying customer," "before scale") are the actual urgency signal.

---

## 1. The reframe: retention is Creem's problem, not ours

**Creem is the Merchant of Record.** It issues the invoice and owns the statutory tax record. The 6–10 year financial-retention duty attaches to whoever issued the invoice — that's Creem.

**What this means for us:**

- Our copy of `payment_history` is a legitimate-interest business record (Art. 6(1)(f)), not a legally-mandated one.
- We probably **can't** use Art. 17(3)(b) to refuse a user's erasure request for their payment data.
- Keeping the full raw provider payload forever is a data-minimisation problem (Art. 5(1)(c)).

**What to do:** store less at write time. Not write a longer retention policy.

> **Unconfirmed:** this depends on Creem's actual merchant terms/DPA — some MoR contracts push retention duties back onto the merchant. Not yet checked (see §10). Treat this as the working hypothesis, not settled fact.

---

## 2. We're still the controller

MoR status removes PCI-DSS scope and VAT/invoicing recordkeeping. It does **not**:

- Remove our own Art. 5, 6, 13–14, 15–22, 25, 32 duties for our copy of the data
- Make us a processor instead of a controller
- Let us redirect an erasure request to Creem — it's about our copy, only we can act on it

---

## 3. PCI-DSS scope — verified unchanged

Grepped every type file under `node_modules/creem/dist/commonjs/models/components/` for `last4`, `cardBrand`, `pan`, `cvv`, `cvc`, `expMonth`, `cardNumber`: **zero matches**. No `CardEntity` or `PaymentMethodEntity` type exists. Creem never sends card data to our webhook. The migration doesn't touch PCI scope.

---

## 4. `payment_history` on an erasure request: anonymise, don't delete

| Field | Treatment |
|---|---|
| `customer_email` | Erase/anonymise, unless there's an active dispute |
| `payment_gateway_response` (raw payload) | Erase or heavily redact; better fix — stop storing it verbatim |
| `metadata` | Strip PII fields, keep operational ones |
| `amount`, `currency` | Keep, anonymised — needed for the financial trail |
| `user_id` | Null or tombstone |

Anonymising in place (an `UPDATE`) keeps the revenue trail without touching FK `onDelete` rules.

**The email lives in three places** — a redaction routine must hit all of them:

1. `customer_email` column
2. `payment_gateway_response.customer.email` (jsonb)
3. An email-mismatch audit signal in `metadata` — **new**, added by the current payment migration, easy to miss

---

## 5. The bigger risk isn't payments — it's `job_applications`

Payments have Creem absorbing card data and tax records. Nothing absorbs this:

| Columns | Risk |
|---|---|
| `resume_content`, `cover_letter`, `notes`, `interview_notes` | Free text where users disclose health, disability, immigration status — potential Art. 9 special-category data |
| `recruiter_email`, `hiring_manager_email`, `interviewer_email`, `contacts` (jsonb) | Personal data on third parties who never consented and aren't our users. No lawful basis documented anywhere |

---

## 6. Schema landmines — verified

| Landmine | Detail |
|---|---|
| No FK to `users` | `queue_messages`, `batch_tailoring_runs`, `beta_invites` carry user-id columns (first two also carry resume/job-description text) with **no FK**. Nothing blocks or flags their omission from erasure — these get silently forgotten. |
| `beta_invites` used to have the FK | `migrations-archive/1763100000000-add-beta-access.ts`: `redeemed_by_user_id UUID NULL REFERENCES "users"("id") ON DELETE SET NULL`. The squashed `InitialSchema` recreates the table without it. Nobody decided this — lost in a squash. |
| CASCADE deletes the DB row, not the S3 object | Deleting `user_resumes` via CASCADE leaves the S3 object behind. Reuse the existing pattern: `src/shared/services/archive-purge.service.ts:56-57` (`s3Service.extractS3KeyFromUrl` + `deleteObject`). |
| Six tables FK `users` with `NO ACTION` | `payment_history`, `user_subscriptions`, `resume_generations`, `ats_match_histories`, `job_applications`, `usage_tracking`. `DELETE FROM users` fails today — keep it that way. Build the erasure service around the order below instead of flipping FKs to CASCADE. |

---

## 7. Erasure order (authoritative)

1. `job_applications` (cascades `job_application_interviews`)
2. `resume_generations`, `ats_match_histories` — must run after step 1
3. `usage_tracking`, `user_subscriptions`
4. `payment_history` — anonymise, don't delete (§4)
5. `queue_messages`, `batch_tailoring_runs` / `batch_tailoring_jobs` — no FK forces this; don't forget it
6. `beta_invites` — null `redeemed_by_user_id`, redact `email` if it matches the account
7. `users` row — delete; CASCADE cleans up the rest
8. S3 objects for the user's `user_resumes`

---

## 8. Build one `UserErasureService`

`src/modules/user/services/user-erasure.service.ts`, flat-repository style like the existing `ArchivePurgeService`. Wrap steps 1–6 above in one `dataSource.transaction()` — the codebase uses no transactions elsewhere; worth the exception because a half-erased user is worse.

**Skip:** `PurgeableModule` interface, event fan-out, soft-delete on `users`, crypto-shredding, column-level encryption, selective backup scrubbing. None of these earn their cost at this stage.

| Piece | Estimate |
|---|---|
| Service skeleton + trigger | 0.5d |
| Transactional deletion routine | 1d |
| S3 purge | 0.5d |
| Minimal erasure audit trail | 0.25d |
| Regression test: every user-id column is handled or CASCADE-covered | 0.5d |
| **Total** | **~3d** |

---

## 9. Backups

Deleting/anonymising a row today doesn't touch snapshots already taken. Don't attempt selective backup scrubbing — disproportionate effort for a beta product. Document Railway's real retention window, and state factually per erasure: live-database erasure happened on date X, data may persist in backups until that window expires.

---

## 10. Open questions — resolve before finalizing the advice above

- [ ] Railway's actual Postgres region — not in the repo (`railway.toml` pins none; `postgres.railway.internal` reveals nothing). Determines if an international-transfer mechanism is needed.
- [ ] `AWS_REGION` points at an Indian region for S3, where resumes likely live — a **separate** transfer question from the DB region above.
- [ ] Does Creem's merchant terms include a DPA/SCCs, and do they push retention duties onto us? Gates §1.
- [ ] Do any EU or CCPA-covered users exist in the beta today? Changes urgency, not obligation.
- [ ] Does the resume/AI pipeline systematically extract Art. 9-adjacent attributes (age from graduation dates, nationality, photos), or only store verbatim user text? Decides if §5 is "monitor" or "needs a DPIA."
- [ ] No `ssl`/`sslmode` configured on the app→Postgres connection (`data-source.ts`, `database.module.ts`) — confirm intentional.

---

## 11. Prioritized actions

| Action | Effort | Exposure if skipped | Deadline |
|---|---|---|---|
| Privacy policy | 4–8h | High — Art. 13 notice is overdue for current beta users | Before first paying customer |
| Build `UserErasureService` (§8) | ~3d | No way to honor an erasure request today | Before first paying customer |
| Confirm Creem DPA terms | 1–2h | §1's whole retention strategy depends on this | Before first paying customer |
| Verify Railway region + transfer basis | 1h | Unknown if an international-transfer mechanism is required | Before first paying customer |
| Redact `customer.*` at write time in the webhook payload | Small | §4's email duplication keeps accumulating | Before first paying customer — in progress |
| Scheduled redaction of payload after dispute window (~120–180d) | 4–8h | Raw payloads retained indefinitely past need | Before scale |
| Records of processing (Art. 30) | 2–3h | Documentation gap | Before scale |
| Breach-notification runbook | 1–2h | No defined process if an incident happens | Before scale |
| Audit `job_applications` free text for special-category exposure | 2–4h | Unquantified Art. 9 risk (§5) | Before scale |
| Retention bound on unredeemed `beta_invites` | 1h | Low-severity, unbounded growth | Nice to have |
