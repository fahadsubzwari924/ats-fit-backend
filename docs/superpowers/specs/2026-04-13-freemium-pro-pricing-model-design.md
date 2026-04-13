# Freemium + Pro Pricing Model — Design Spec

**Date:** 2026-04-13  
**Status:** Approved  
**Scope:** Backend + seed data alignment to Freemium / Pro two-tier pricing model

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

## Section 2: Rate Limit Configs

`initializeRateLimitConfigs()` in `src/modules/rate-limit/rate-limit.service.ts` is rewritten with the complete canonical set:

| Plan | Feature | Monthly Limit | Notes |
|------|---------|--------------|-------|
| `FREEMIUM` | `RESUME_GENERATION` | 3 | Was 5 |
| `FREEMIUM` | `COVER_LETTER` | 1 | Was missing (bug fix) |
| `PREMIUM` | `RESUME_GENERATION` | 30 | Was 50 |
| `PREMIUM` | `COVER_LETTER` | 15 | Was missing (bug fix) |
| `PREMIUM` | `RESUME_BATCH_GENERATION` | 10 | Was 25 |

**Omissions (intentional):**
- `FREEMIUM / RESUME_BATCH_GENERATION` — batch is blocked at the route level by `PremiumUserGuard`; a config row would be misleading
- `JOB_APPLICATION_TRACKING` — unlimited for all plans; no route uses `@RateLimitFeature(JOB_APPLICATION_TRACKING)`

---

## Section 3: Rate Limit Service — Usage Stats & Dashboard

### `getUserUsageStats()`

Expanded return shape:

```typescript
{
  resume_generation: RateLimitResult,
  cover_letter: RateLimitResult,
  resume_batch_generation?: RateLimitResult  // PREMIUM only
}
```

`resume_batch_generation` is omitted for FREEMIUM users — no point surfacing a stat for a blocked feature.

### `getFormattedFeatureUsage()`

The array returned to `GET /users/feature-usage` is expanded to match:
- **FREEMIUM:** 2 entries (`resume_generation`, `cover_letter`)
- **PREMIUM:** 3 entries (`resume_generation`, `cover_letter`, `resume_batch_generation`)

Plan is determined from `userContext.plan` which is already available in both methods.

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

## Section 5: Batch Generation Route — Premium Gate

### Route: `POST /resume-tailoring/batch-generate`

Two changes to the decorator stack:

1. **Add `@UseGuards(PremiumUserGuard)`** — rejects FREEMIUM users with `403 Forbidden` + `ERROR_CODES.PREMIUM_REQUIRED` before any business logic runs
2. **Uncomment `@RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)`** — enforces the 10 batches/month cap for Pro users after they pass the premium gate

### Guard execution order

```
JwtAuthGuard → PremiumUserGuard → RateLimitGuard → handler
```

- FREEMIUM → rejected at `PremiumUserGuard` with upgrade-prompt-friendly error
- PREMIUM within limit → passes all guards, handler runs
- PREMIUM over limit → rejected at `RateLimitGuard` with usage metadata

### No handler changes

The 3-jobs-per-batch hard limit (`BULK_TAILORING_MAX_RESUMES`) remains unchanged.

### Frontend contract

`403` with `ERROR_CODES.PREMIUM_REQUIRED` signals the frontend to show an upgrade prompt. This error code is already defined in `error-codes.ts` — nothing new needed.

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
