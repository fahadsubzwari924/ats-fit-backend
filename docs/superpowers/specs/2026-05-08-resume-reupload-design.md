# Resume Re-Upload (Replace) Design

**Status:** Approved (design phase) — pending implementation plan
**Date:** 2026-05-08
**Author:** Fahad Subzwari (with Claude)
**Scope:** Backend (NestJS) + Frontend (Angular 19) — single feature, single spec

---

## 1. Problem

Today the dashboard exposes a "delete resume" + separate upload as two manual steps. The current behavior is unsafe:

- `Resume` row + S3 file are deleted, but `ExtractedResumeContent`, `EnrichedResumeProfile`, `TailoringQuestion` rows are keyed on `user_id` (not `resume_id`) and silently survive as orphans.
- A subsequent upload spawns a brand-new extract + questions + enrichment. There is no notion of which extract is "current" — downstream queries pick whatever ordering happens to match.
- `User.onboarding_completed` is never reset, but the user is left in an ambiguous state where the dashboard banner, questions, and tailoring gates can disagree.
- Tailoring is not gated on enrichment readiness, so a user can tailor with stale enrichment that does not match their newly uploaded resume.
- The user is given no warning about what happens to their answers, ATS history, or tailoring access.

This spec defines a deliberate **replace** flow that is safe, communicative, and entitlement-aware.

## 2. Goals & Non-Goals

**Goals**

- One atomic action that replaces the active resume and resets the profile setup pipeline.
- Clear in-modal communication about what changes, what survives, and how long the user is locked out of tailoring.
- Soft-archive of prior data so the system has a recovery path for the inevitable "wrong file" mistake.
- Plan-gated entitlement: free users blocked, premium users metered.
- Single source of truth for "active resume" enforced at the DB layer.

**Non-Goals (deferred to v2)**

- Multi-resume library (user maintains N resumes, picks active per job).
- Smart-merge of prior answers when work history overlaps.
- User-initiated "restore previous resume" button (only surfaced on extraction-fail recovery in v1).
- Automated test suite for this feature (deferred per product call).
- Wizard re-entry / redoing onboarding flow (replacement happens entirely on dashboard).

## 3. Decisions Locked

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Re-upload trigger reasons covered | All three (update, wrong file, pivot) | Cannot bias UX toward any single reason. Treat as fresh start by default. |
| Atomicity | Immediate replace | New resume becomes active instantly. Tailoring locked through `processing → questions_pending → enriching → complete`. Single source of truth, simpler than staged draft. |
| Old data fate | Soft archive | `is_active=false` + `archived_at`. Children (enrichment, questions) resolve activeness via FK to extract. Foundation for future undo. |
| Confirmation flow | Single combined modal | One `Replace` button → modal with warning + impact + file picker + CTA. Three clicks, focused, no friction tax. |
| Quota window | Billing-period aligned | Premium monthly = current_period_start; premium yearly = monthly anniversary of subscription start. Aligns with billing mental model. |
| Entitlement | Free = blocked, Premium = 3/month | Re-upload consumes Claude tokens (extract + enrichment). Hard cost. |
| Data model strategy | `is_active` flag on extract (Approach A) | Minimal schema change; partial unique index is bulletproof; matches soft-archive choice. |
| Feature flag | None (pre-launch) | Direct deploy, no gradual rollout overhead. |

## 4. Data Model

### 4.1 Schema changes

```sql
-- extracted_resume_content
ALTER TABLE extracted_resume_content
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN archived_at TIMESTAMPTZ NULL;

-- Drop global unique on file_hash; replace with per-user-active partial uniques
DROP INDEX IF EXISTS uq_extracted_resume_content_file_hash;
CREATE UNIQUE INDEX idx_extracted_resume_content_user_active
  ON extracted_resume_content (user_id)
  WHERE is_active = TRUE;
CREATE UNIQUE INDEX idx_extracted_resume_content_user_filehash_active
  ON extracted_resume_content (user_id, file_hash)
  WHERE is_active = TRUE;

-- resumes (S3-tracked file table)
ALTER TABLE resumes
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN archived_at TIMESTAMPTZ NULL;
CREATE UNIQUE INDEX idx_resumes_user_active
  ON resumes (user_id)
  WHERE is_active = TRUE;
```

`is_active` on both `Resume` and `ExtractedResumeContent` for symmetry — dashboard queries follow one consistent rule.

`EnrichedResumeProfile` and `TailoringQuestion` get **no flag**. Active resolution = follow FK to extract, check `extract.is_active`. Single source of truth across three tables.

### 4.2 Backfill (in same migration)

```sql
-- Default `is_active=true` already covers single-extract users.
-- For users with multiple extracts: keep newest, archive rest.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn,
         updated_at
  FROM extracted_resume_content
)
UPDATE extracted_resume_content e
SET is_active = FALSE,
    archived_at = ranked.updated_at
FROM ranked
WHERE e.id = ranked.id AND ranked.rn > 1;

-- Same for resumes table.
```

Migration must run before partial unique index creation (otherwise constraint will fail on multi-active users).

### 4.3 New table: `resume_replacement_audit`

```sql
CREATE TYPE resume_replacement_kind AS ENUM ('replacement', 'restore');

CREATE TABLE resume_replacement_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind resume_replacement_kind NOT NULL DEFAULT 'replacement',
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  succeeded BOOLEAN NOT NULL,
  archived_extract_id UUID NULL REFERENCES extracted_resume_content(id) ON DELETE SET NULL,
  new_extract_id UUID NULL REFERENCES extracted_resume_content(id) ON DELETE SET NULL,
  failure_code TEXT NULL,
  idempotency_key TEXT NULL
);

CREATE INDEX idx_resume_replacement_audit_user_attempted
  ON resume_replacement_audit (user_id, attempted_at DESC);
CREATE UNIQUE INDEX idx_resume_replacement_audit_idempotency
  ON resume_replacement_audit (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

Append-only. Drives quota counting + telemetry + future analytics.

### 4.4 `User.onboarding_completed` semantics

Stays `TRUE` permanently after first completion. Re-upload does **NOT** reset it. Onboarding wizard route guard remains effective; users replacing a resume never route back to the wizard.

## 5. Backend API

### 5.1 New endpoint: `POST /users/replace-resume`

```
POST   /users/replace-resume
Auth   JWT required
Headers
  Idempotency-Key: <client-generated UUID>   (optional but recommended)
Body   multipart/form-data
  file: PDF or DOCX, ≤ 5 MB
```

Success (`202 Accepted`):

```json
{
  "status": "queued",
  "newResumeId": "uuid",
  "newProcessingId": "uuid",
  "archivedExtractId": "uuid",
  "archivedAt": "2026-05-08T12:34:56Z",
  "quota": { "used": 2, "limit": 3, "resetsAt": "2026-06-08T00:00:00Z" }
}
```

### 5.2 Service flow (`UserService.replaceResume`)

```
1. Resolve user; assert plan ∈ {PREMIUM_MONTHLY, PREMIUM_YEARLY}.
   → Free: 403 UPGRADE_REQUIRED.
2. Compute current quota window (Section 5.4); count succeeded audits.
   → ≥ 3: 429 REPLACEMENT_QUOTA_EXCEEDED with resetsAt.
3. If Idempotency-Key present and matches an audit row in last 30s
   → return cached response of original attempt.
4. Validate file (size, mime). On fail: 400 INVALID_FILE.
5. Resolve current active extract; if none: 409 NO_ACTIVE_RESUME.
6. Compute file hash; if matches active extract's hash:
   → 409 SAME_FILE_AS_ACTIVE (no quota consumed, no audit row marked succeeded).
7. Upload file to S3. On fail: 502 STORAGE_UPLOAD_FAILED.
8. BEGIN TX with SELECT ... FOR UPDATE on users row (serializes concurrent attempts).
   a. Update current Resume: is_active=false, archived_at=now.
   b. Insert new Resume: is_active=true.
   c. Update current ExtractedResumeContent: is_active=false, archived_at=now.
   d. Insert new ExtractedResumeContent: is_active=true, status=QUEUED.
9. COMMIT.
10. Insert resume_replacement_audit OUTSIDE the TX (separate statement): kind='replacement', succeeded=true, archived_extract_id, new_extract_id, idempotency_key.
11. Enqueue resume_processing job (queueMessageId = new extract.id).
12. Return 202 with payload.

Failure handling:
- Failure at steps 1–7 (pre-TX): insert audit row with succeeded=false + failure_code (e.g., QUOTA_EXCEEDED, INVALID_FILE, STORAGE_UPLOAD_FAILED). No DB state changed.
- Failure at step 8/9 (inside TX): TX rolls back. After rollback, insert audit row with succeeded=false + failure_code='TX_FAILED' (separate statement, separate connection).
- Failure at step 10 (audit insert): non-fatal. Log error, return 202 anyway. Replacement is real; only telemetry is missing.
- Failure at step 11 (queue enqueue): TX already committed → cron sweeper recovers (Section 5.5). Audit shows succeeded=true (state-correct).

Quota check (step 2) counts only `kind='replacement' AND succeeded=true` rows.
```

### 5.3 Tailoring gate (NEW)

Add to `resume-generation-orchestrator.service` (or as dedicated guard):

```ts
const activeExtract = await getActiveExtractForUser(userId);
if (!activeExtract) {
  throw new ConflictException('NO_ACTIVE_RESUME');
}
if (activeExtract.status !== ExtractionStatus.COMPLETED) {
  throw new ConflictException('RESUME_PROFILE_NOT_READY');
}
const activeEnrichment = await getEnrichmentForExtract(activeExtract.id);
if (!activeEnrichment || activeEnrichment.status !== EnrichmentStatus.COMPLETED) {
  throw new ConflictException('PROFILE_ENRICHMENT_IN_PROGRESS');
}
```

Frontend already polls `GET /users/resume-profile-status` — surface same codes there.

### 5.4 Quota window math

```
plan = PREMIUM_MONTHLY
  windowStart = subscription.current_period_start

plan = PREMIUM_YEARLY
  rawAnchorDay = day-of-month of subscription.start_date
  // Clamp to last day of target month (handles month with fewer days than anchor)
  effectiveAnchorDay(month) = MIN(rawAnchorDay, daysInMonth(month))
  todayAnchor = effectiveAnchorDay(currentMonth)
  if today.day >= todayAnchor:
    windowStart = (this month, todayAnchor, 00:00 UTC)
  else:
    prevMonth = currentMonth - 1
    windowStart = (prevMonth, effectiveAnchorDay(prevMonth), 00:00 UTC)

count = SELECT COUNT(*) FROM resume_replacement_audit
        WHERE user_id = ?
          AND kind = 'replacement'
          AND succeeded = true
          AND attempted_at >= windowStart
```

`succeeded=false` rows do not count — failures are quota-free, encouraging retry on transient errors.

### 5.5 Existing endpoints — semantics changes

- **`POST /users/upload-resume`** — unchanged. First-time upload. Throws if user already has an active extract (instructs to use `/replace-resume` instead).
- **`DELETE /users/delete-resume/:resumeId`** — restricted: throws `409 CANNOT_DELETE_ACTIVE_RESUME` if `resumeId` is the active resume. Only deletes archived/inactive resumes. Frontend hides the button when only one active resume exists.
- **`GET /users/resume-profile-status`** — unchanged shape, plus computed field `replacementInProgress: boolean`. True iff active extract is QUEUED/PROCESSING and a prior archived extract exists.

### 5.6 New endpoint: `POST /users/restore-archived-resume`

```
POST /users/restore-archived-resume
Body: { archivedExtractId: "uuid" }
```

- Validates archive belongs to user, `archived_at` within last 7 days.
- Atomically: flip target back to active, flip current active to archived.
- Quota-free. Records audit row with `kind='restore'`, `succeeded=true`. Quota counter ignores `kind='restore'` rows.
- Surfaced only on extraction-fail recovery banner in v1 UI (no general-purpose user-initiated restore button).

### 5.7 Cron jobs

- **Stuck-job sweeper** (existing pattern): every 1 min, find extracts in `QUEUED/PROCESSING` for >5 min, re-enqueue. After N retries → mark `FAILED`.
- **Archive purge** (new): daily, hard-delete `extracted_resume_content` rows where `is_active=false AND archived_at < now() - INTERVAL '90 days'`. Cascades to enrichments, questions, and the corresponding archived `Resume` row + S3 file.

## 6. Frontend (Angular 19)

### 6.1 Entry point

Existing `tailore-resume-upload.component.html` resume card. Replaces commented stub at line 122 with real Replace button:

```
┌─ Resume card ─────────────────────────────────┐
│ resume_v3.pdf · Active                        │
│ Uploaded 12 days ago                          │
│  [Download]  [Replace]  [Delete]              │
└───────────────────────────────────────────────┘
```

Delete button hidden when only the active resume exists (no archived resumes to delete in v1 UI).

### 6.2 Plan-gated CTA

- Free users: Replace button shows lock icon → click opens existing `upgrade-feature-dialog`.
- Premium users: button opens replace modal (Section 6.3).

Plan check uses existing `UserState` selector; no new entitlement code.

### 6.3 Replace modal — content & behavior

```
┌─ Replace Resume ─────────────────────────────┐
│                                              │
│  Replacing your resume restarts profile      │
│  setup. Here's what happens:                 │
│                                              │
│  ✓ Past tailored resumes stay accessible     │
│  ✓ ATS scores + job applications preserved   │
│  ⟳ New work-experience questions generated   │
│  ⟳ Tailoring locked for ~2 minutes           │
│                                              │
│  ⚠  Your X previous answers will be archived │
│                                              │
│  Quota: 2 of 3 replacements used this month  │
│  Resets May 15.                              │
│                                              │
│  ┌─ Drop new resume here ─────────────────┐  │
│  │   PDF or DOCX, max 5 MB                │  │
│  │   [ Browse files ]                     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│           [ Cancel ]   [ Replace resume ]    │
└──────────────────────────────────────────────┘
```

- `X` = current `questionsAnswered` from `ResumeProfileState`. The "Your X previous answers will be archived" line is hidden entirely when `questionsAnswered === 0` (no answers to lose, no warning needed).
- Quota line driven by `GET /users/resume-profile-status` extension or new `GET /users/replacement-quota` if cleaner.
- CTA disabled until file passes inline validation (size, mime).
- Submit posts to `/users/replace-resume` with client-generated `Idempotency-Key`. On success: close modal, fire toast "Profile setup started", let state machine drive UI.

Built on existing Angular Material `MatDialog` pattern (per `ModalService`).

### 6.4 State machine integration

`resume-profile.state.ts` already has the 8-state machine and the `processing → questions_pending → enriching → complete` transition. **Zero new states.**

Add a single computed flag `isReplacement()` on the state, derived from `replacementInProgress` field on the status response. Drives copy variants:

| State | Initial copy | Replacement copy |
|-------|--------------|------------------|
| `processing` | "Reading your resume..." | "Reading your new resume..." |
| `questions_pending` | "A few questions about your work" | "A few questions about your updated work history" |
| `enriching` | "Building your profile..." | "Refreshing your profile..." |
| `complete` | "All set, ready to tailor" | (toast: "Profile updated. Tailoring ready.") |

### 6.5 Tailoring entry blocked during replacement

Existing `isProfileComplete()` computed at `resume-insights-questions.component.ts:62` already guards the TailorApply modal. No new gate component. Copy on the gate updated to use `isReplacement()` for replacement-phrased messaging.

### 6.6 Other surfaces during replacement

- Job-application list: fully accessible, untouched module.
- ATS history: read-only, untouched.
- Past tailored resume downloads: untouched.
- Onboarding wizard route guard: unchanged. Re-upload never resets `onboarding_completed`, so guard still blocks wizard re-entry.

### 6.7 Failure UX

Mapping of backend codes to UI:

| Code | UX |
|------|----|
| `UPGRADE_REQUIRED` | Open upgrade dialog, do not show replace modal |
| `REPLACEMENT_QUOTA_EXCEEDED` | Toast with `resetsAt` |
| `INVALID_FILE` | Inline modal validation pre-submit |
| `STORAGE_UPLOAD_FAILED` | Toast: retryable, modal stays open |
| `INTERNAL_ERROR` | Toast: retryable, modal stays open |
| `SAME_FILE_AS_ACTIVE` | Inline modal message: "That's the same file you already have." No quota consumed. |
| `extract.status = FAILED` (async) | Banner on dashboard: "Could not read your new resume." with `[Try again]` and `[Restore previous resume]` buttons. |

`Restore previous resume` calls `/users/restore-archived-resume` with the archived extract id. Quota-free. Returns dashboard to `complete` state with prior profile.

## 7. Edge Cases

| ID | Scenario | Handling |
|----|----------|----------|
| E1 | Same file re-uploaded | Pre-upload hash check, 409 `SAME_FILE_AS_ACTIVE`, no quota consumed |
| E2 | Extraction fails on new resume | Banner with Try-again + Restore-previous; restore is quota-free |
| E3 | User abandons mid-flow | State machine remains `questions_pending` across sessions; same as initial onboarding abandonment |
| E4 | Concurrent replace from two tabs | `SELECT ... FOR UPDATE` serializes; idempotency key dedups identical retries within 30s |
| E5 | Subscription downgrade mid-flow | Quota check at endpoint entry only; in-flight replacement completes; future tailoring blocked by normal plan limits |
| E6 | Background job lost (worker crash) | Stuck-job sweeper re-enqueues; after retries → `FAILED` → E2 path |
| E7 | Stale quota in modal (used elsewhere first) | Backend rejects with 429, frontend surfaces toast and closes modal |
| E8 | Storage growth from archives | 90-day archive purge cron deletes archived rows + S3 files |

## 8. Telemetry

Events (existing analytics pipeline, else log):

- `resume_replacement_modal_opened` — userId, plan, currentQuotaUsed, currentQuotaTotal
- `resume_replacement_modal_dismissed` — userId, reason (cancel / upgrade-redirect / quota-blocked / same-file)
- `resume_replacement_submitted` — userId, fileSize, fileMime, archivedExtractId
- `resume_replacement_completed` — userId, durationMs, archivedExtractId, newExtractId
- `resume_replacement_failed` — userId, stage (extract / enrich), errorCode
- `resume_replacement_restored` — userId, restoredExtractId, hoursSinceArchive
- `resume_replacement_quota_exceeded` — userId, plan, billingPeriodStart

Powers future tuning: real abuse rate, fail rate per stage, restore frequency (signal that quota is too tight).

## 9. Migration & Rollout

1. **DB migration** — add `is_active` + `archived_at` to `extracted_resume_content` and `resumes`; backfill multi-extract users; drop global file_hash unique; create partial unique indexes.
2. **DB migration** — create `resume_replacement_audit` table with idempotency unique index.
3. **Backend deploy** — `/users/replace-resume`, `/users/restore-archived-resume`, tailoring gate, revised DELETE semantics, `/resume-profile-status` extension, quota service. Live immediately.
4. **Frontend deploy** — Replace button visible, upgrade modal for free users, revised state-machine copy.
5. **Manual smoke verification** — happy path + edge cases (free-block, quota exhaust, restore-on-fail, concurrent tabs, same-file rejection).

No feature flag (pre-launch). No staged rollout.

**Rollback:** migrations are additive (down-migration drops new columns + table cleanly). If endpoint breaks post-deploy: revert backend tag; frontend Replace button errors via toast; old upload + delete fallback still functions.

## 10. Testing

Deferred per product call. Manual smoke verification only. Test infrastructure for this feature is a v2 candidate.

## 11. Documentation

- `docs/ARCHITECTURE.md` — add "Resume lifecycle" subsection covering active/archived semantics and the soft-archive pattern.
- `docs/API-PATTERNS.md` — document soft-archive + idempotency-key pattern as templates for future entities.
- `docs/CONVENTIONS.md` — add idempotency-key header convention if not already present.

## 12. Open Questions

None at design time. All decisions locked above.

## 13. Out of Scope (v2 Candidates)

- Multi-resume "library" mode (user picks active resume per job application).
- Smart-merge of prior answers when work-history overlap detected.
- User-initiated `Restore previous resume` button (v1 surfaces it only on extraction-fail recovery banner).
- Automated test suite (unit, integration, E2E).
- Free-tier paid one-shot replacement (e.g., $X to replace once).
