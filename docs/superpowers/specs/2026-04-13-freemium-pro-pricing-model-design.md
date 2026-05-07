# Freemium + Pro Pricing Model — Design Spec

**Date:** 2026-04-13 (revised 2026-05-07)
**Status:** Approved (revised — shared-pool quota model)
**Scope:** Backend + seed data alignment to Freemium / Pro two-tier pricing model

> **2026-05-07 revision — shared-pool quota model.** The original design implemented `RESUME_GENERATION` (30) and `RESUME_BATCH_GENERATION` (10) as **independent pools**, allowing a Pro user to consume up to 60 tailored resumes per month (30 single + 30 from batch). Unit-economics review showed this was unsustainable on Pro Annual ($7.42/mo equivalent) and the locked Founding rate ($7.20/mo). The revised model uses a **single shared pool of 30 tailored resumes per month**: every resume produced — single or batch — counts as 1 against `RESUME_GENERATION`. `RESUME_BATCH_GENERATION` (10/mo) becomes a structural cap on the **number of batch jobs**, not a separate resume pool. Section 2 below reflects the revised semantics.

---

## Context

ATS Fit is adopting a **Freemium + Pro** pricing model replacing the previous three-plan seed data (Weekly $9.99, Monthly $34.99, Premium Monthly $100). The new model gives users a generous permanent free tier to experience real value, with a single Pro plan for active job seekers who need higher limits and batch generation.

This is a pre-launch change — no real subscribers exist. All seed data can be cleanly replaced.

---

## Pricing Summary

| Plan | Price | Billing Cycle |
|------|-------|---------------|
| Free (Freemium) | $0 | — |
| Pro Monthly | $12.00 | Monthly |
| Pro Annual | $89.00 | Yearly (~$7.42/mo, 38% saving) |

---

## Section 1: Subscription Plans Seed

### Plans to seed

**Pro Monthly**
- `plan_name`: `"Pro Monthly"`
- `price`: `12.00`
- `billing_cycle`: `BillingCycle.MONTHLY`
- `payment_gateway_variant_id`: `"PLACEHOLDER_MONTHLY_VARIANT_ID"` *(swap when Lemon Squeezy product is created)*
- `is_active`: `true`
- Features:
  - 30 tailored resumes per month
  - 15 cover letters per month
  - Batch generation (up to 3 jobs/batch, 10 batches/month)
  - All resume templates
  - Unlimited job application tracking
  - Full generation history
  - Priority support

**Pro Annual**
- `plan_name`: `"Pro Annual"`
- `price`: `89.00`
- `billing_cycle`: `BillingCycle.YEARLY`
- `payment_gateway_variant_id`: `"PLACEHOLDER_ANNUAL_VARIANT_ID"` *(swap when Lemon Squeezy product is created)*
- `is_active`: `true`
- Features: Same as Pro Monthly, plus "Best value — save 38%"

### Files affected
- `src/scripts/seed/seed-subscription-plans.ts` — replace plan array with the two Pro plans above
- `src/scripts/seed/seed-subscription-plans-service.ts` — same replacement

### BillingCycle enum cleanup
Remove `WEEKLY` from `src/modules/subscription/enums/billing-cycle.enum.ts`. Only `MONTHLY` and `YEARLY` remain. No other code references `BillingCycle.WEEKLY`.

---

## Section 2: Rate Limit Configs (shared-pool model)

`initializeRateLimitConfigs()` in `src/modules/rate-limit/rate-limit.service.ts` is rewritten with the complete canonical set:

| Plan | Feature | Monthly Limit | Semantics |
|------|---------|--------------|-----------|
| `FREEMIUM` | `RESUME_GENERATION` | 3 | Tailored resumes produced per month (Free has no batch route). |
| `FREEMIUM` | `COVER_LETTER` | 1 | Cover letters per month. |
| `PREMIUM` | `RESUME_GENERATION` | 30 | **Total tailored resumes produced per month — single + batch share this pool.** |
| `PREMIUM` | `COVER_LETTER` | 15 | Cover letters per month. |
| `PREMIUM` | `RESUME_BATCH_GENERATION` | 10 | **Batch *jobs* per month (structural cap). Each batch job also consumes 1 × resumes-in-batch from the `RESUME_GENERATION` pool.** |

### Shared-pool semantics

The Pro user gets **30 tailored resumes per month** as a single pool. Whether they generate one job at a time (single) or three at once (batch), every resume produced is a unit drawn from the same 30. The 10 batch-jobs cap is a structural limit on how often the batch UX can be invoked, not an additional resume budget.

**Increment rules:**
- **Single tailoring** (`POST /resume-tailoring/generate`) → +1 to `RESUME_GENERATION`.
- **Batch tailoring** (`POST /resume-tailoring/batch-generate` with N jobs) → +1 to `RESUME_BATCH_GENERATION` (the batch job itself), and +1 to `RESUME_GENERATION` per resume successfully produced inside the batch (so a 3-job batch costs 3 resumes from the monthly pool).

**Pre-check on batch:**
- Before enqueueing a batch of N jobs, the controller verifies both:
  1. `currentUsage(RESUME_GENERATION) + N ≤ 30`
  2. `currentUsage(RESUME_BATCH_GENERATION) + 1 ≤ 10`
- If either would exceed, return **403** with `ERROR_CODES.RATE_LIMIT_EXCEEDED` and structured `{ feature, currentUsage, limit, remaining, resetDate }`. The error feature should reflect whichever cap was hit first.

**Worst-case monthly cost ceiling per Pro user:**
- 30 tailored resumes × ~$0.14/gen + 15 cover letters × ~$0.05 ≈ **$4.95 LLM cost/user/month** (vs ~$8.40 under the old separate-pools model).

**Omissions (intentional):**
- `FREEMIUM / RESUME_BATCH_GENERATION` — batch is blocked at the route level by `PremiumUserGuard`; a config row would be misleading.
- `JOB_APPLICATION_TRACKING` — unlimited for all plans; no route uses `@RateLimitFeature(JOB_APPLICATION_TRACKING)`.

---

## Section 3: Rate Limit Service — Usage Stats & Dashboard

### `getUserUsageStats()`

Return shape (unchanged from original spec — semantics changed only):

```typescript
{
  resume_generation: RateLimitResult,         // tailored resumes produced (single + batch share this pool)
  cover_letter: RateLimitResult,
  resume_batch_generation?: RateLimitResult   // PREMIUM only — batch jobs cap (structural)
}
```

`resume_batch_generation` is omitted for FREEMIUM users — no point surfacing a stat for a blocked feature.

### `getFormattedFeatureUsage()`

The array returned to `GET /users/feature-usage` is:
- **FREEMIUM:** 2 entries (`resume_generation`, `cover_letter`)
- **PREMIUM:** 3 entries (`resume_generation`, `cover_letter`, `resume_batch_generation`)

`resume_generation` is the **primary stat** the dashboard displays ("23 of 30 tailored resumes used"). `resume_batch_generation` is secondary metadata (batch-jobs counter), surfaced only inside the Quick Tailor flow for transparency. Plan is determined from `userContext.plan` which is already available in both methods.

### Error behaviour

`checkRateLimit()` continues to throw `BadRequestException` when a config row is missing — this is a data integrity bug, not a graceful degradation case.

---

## Section 4: Generation History — 30-Day Lookback for Free Plan

### Behaviour

- **FREEMIUM:** `getResumeGenerationHistory()` and `getResumeGenerationHistoryPaginated()` add a `WHERE created_at >= NOW() - INTERVAL '30 days'` filter
- **PREMIUM:** No date filter — full history returned

### Implementation

- The controller passes `req.userContext.plan` as an additional argument to both service methods
- Inside the service, if `plan === UserPlan.FREEMIUM`, the date filter is applied to the TypeORM query
- Generation records are **never deleted** — data is always preserved in the DB
- If a FREEMIUM user upgrades to Pro, full history is immediately visible (no backfill needed)
- API response shape is unchanged — FREEMIUM just receives fewer rows

### Files affected
- `src/modules/resume-tailoring/services/resume.service.ts` — add optional `plan` param + date filter logic to both history methods
- `src/modules/resume-tailoring/resume-tailoring.controller.ts` — pass `plan` from `userContext` to both service calls

---

## Section 5: Batch Generation Route — Premium Gate + Shared-Pool Pre-Check

### Route: `POST /resume-tailoring/batch-generate`

Three layers of enforcement:

1. **`@UseGuards(PremiumUserGuard)`** — rejects FREEMIUM users with `403 Forbidden` + `ERROR_CODES.PREMIUM_REQUIRED` before any business logic runs.
2. **`@RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)`** — enforces the 10 batches/month structural cap for Pro users after they pass the premium gate.
3. **In-handler shared-pool pre-check** — before enqueueing, the controller verifies that `currentUsage(RESUME_GENERATION) + N ≤ 30`, where `N` is the count of jobs in the batch payload. If the batch would exceed the shared pool, return **403** with `ERROR_CODES.RATE_LIMIT_EXCEEDED` and a payload identifying `RESUME_GENERATION` as the limiting feature.

### Guard / handler order

```
JwtAuthGuard → PremiumUserGuard → RateLimitGuard (batch jobs cap) → handler (shared-pool pre-check) → enqueue
```

- FREEMIUM → rejected at `PremiumUserGuard` with upgrade-prompt-friendly error.
- PREMIUM over batch-jobs cap → rejected at `RateLimitGuard` with `RESUME_BATCH_GENERATION` metadata.
- PREMIUM with insufficient resume budget for N jobs → rejected by handler pre-check with `RESUME_GENERATION` metadata.
- PREMIUM within both limits → enqueue; on each successful resume completion the batch processor increments `RESUME_GENERATION` by 1.

### Per-resume increment in the batch processor

After each resume in the batch successfully generates, `batch-tailoring-v2.processor.ts` calls `RateLimitService.incrementUsage(userContext, FeatureType.RESUME_GENERATION)`. Failed jobs do NOT consume the user's quota. This keeps the shared pool an accurate count of resumes actually produced.

### No handler structural-limit changes

The 3-jobs-per-batch hard limit (`BULK_TAILORING_MAX_RESUMES = 3`) remains unchanged — it is a per-request safety bound separate from monthly quota.

### Frontend contract

- `403` with `ERROR_CODES.PREMIUM_REQUIRED` signals the frontend to show an upgrade prompt.
- `403` with `ERROR_CODES.RATE_LIMIT_EXCEEDED` and `feature = RESUME_GENERATION` signals "monthly tailored-resume limit would be exceeded" — frontend shows the unified quota-exhausted state.
- `403` with `ERROR_CODES.RATE_LIMIT_EXCEEDED` and `feature = RESUME_BATCH_GENERATION` signals "batch jobs cap reached" — frontend can show the same exhausted UI but explain it's the batch-jobs limit, not the resume pool.

---

## Files Changed (complete list)

| File | Change |
|------|--------|
| `src/scripts/seed/seed-subscription-plans.ts` | Replace 3 old plans with Pro Monthly + Pro Annual |
| `src/scripts/seed/seed-subscription-plans-service.ts` | Same replacement |
| `src/modules/subscription/enums/billing-cycle.enum.ts` | Remove `WEEKLY` |
| `src/modules/rate-limit/rate-limit.service.ts` | Rewrite `initializeRateLimitConfigs()`; expand `getUserUsageStats()` and `getFormattedFeatureUsage()` |
| `src/modules/resume-tailoring/services/resume.service.ts` | Add `plan` param + 30-day filter to both history methods |
| `src/modules/resume-tailoring/resume-tailoring.controller.ts` | Pass `plan` to history service calls; add `PremiumUserGuard` + uncomment `@RateLimitFeature` on batch route |

---

## Out of Scope

- Frontend upgrade prompt UI implementation (backend contract is defined; frontend consumes `PREMIUM_REQUIRED` error code)
- Lemon Squeezy product/variant creation (placeholder IDs in seed — swap before launch)
- Database migrations for existing data (pre-launch, no real subscribers)
- Third pricing tier (revisit when usage data shows >20% of Pro users hitting the 30-generation ceiling)
