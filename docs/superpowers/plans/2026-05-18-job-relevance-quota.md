# Job Relevance Score — Quota & Graceful Degradation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Per `.ai/CONTRACT.md`:** Every task carries `path`, `intent`, `verify`, `agency`, `docs`. Use Agency mapping from `.claude/agents/_index.json` — never `general-purpose`.
>
> **User-directive overrides:** No automated tests in this plan (verification = type-check + lint + build + manual smoke). Commits are batched per repo at the final task — do NOT commit between tasks.

**Goal:** Add `JOB_RELEVANCE_SCORE` as a first-class metered feature (10 freemium / 100 premium per month) with graceful degradation when exhausted — tailoring continues without the Job Fit step instead of hard-blocking. Surface usage in dashboard, profile, tailor modal, in-app pricing cards, and the public website.

**Architecture:**
- **Shared quota pool**: both the standalone `POST /resume-tailoring/relevance` endpoint AND the orchestrator's internal relevance call inside `generateOptimizedResume` consume from the same pool. Cache hits are free (no LLM call → no usage recorded). This is the "Approach F" model.
- **Graceful degradation**: when the user has 0 remaining, the standalone endpoint returns a 403 (consistent with other features), and the orchestrator-internal call returns the existing `UNAVAILABLE` verdict sentinel with `unavailableReason: 'QUOTA_EXHAUSTED'`. FE detects the sentinel and removes the Job Fit step from the stepper — tailoring proceeds normally.
- **Service-owned metering**: usage recording moves into `JobRelevanceService.score()` (right after a successful LLM call, gated by `engine === LLM`). The HTTP endpoint keeps the `@RateLimitFeature` decorator for the guard, but does NOT use `UsageTrackingInterceptor` — avoids double-counting.

**Tech stack:** NestJS 10 + TypeORM (BE), Angular 18 standalone components (FE app), static HTML + Tailwind (website).

---

## File Map

**Backend — created:**
- `src/database/migrations/1815200000000-AddJobRelevanceScoreFeatureType.ts` — ALTER TYPE on both enums + INSERT seed rows for plan limits

**Backend — modified:**
- `src/database/entities/usage-tracking.entity.ts` — add `JOB_RELEVANCE_SCORE = 'job_relevance_score'` to `FeatureType` enum
- `src/modules/job-relevance/enums/job-relevance-skip-reason.enum.ts` — add `QUOTA_EXHAUSTED` reason
- `src/modules/job-relevance/job-relevance.service.ts` — quota check at top of `score()`, usage record after successful LLM call, return UNAVAILABLE sentinel when exhausted
- `src/modules/job-relevance/job-relevance.module.ts` — import `RateLimitModule` for DI
- `src/modules/resume-tailoring/resume-tailoring.controller.ts` — add `@RateLimitFeature(FeatureType.JOB_RELEVANCE_SCORE)` to `POST /relevance` endpoint
- `src/modules/rate-limit/rate-limit.service.ts` — extend the documented "canonical set" JSDoc to include the new feature (no logic change required — service is data-driven via `rate_limit_configs` table)

**Frontend (`ats-fit-frontend`) — modified:**
- `src/app/core/enums/feature-type.enum.ts` — add `JOB_RELEVANCE_SCORE = 'job_relevance_score'`
- `src/app/features/dashboard/constants/feature-title.constant.ts` — add user-facing title `'Job Fit Scoring'`
- `src/app/shared/components/dashboard-hero/dashboard-hero.component.ts` + `.html` — add second usage strip for `JOB_RELEVANCE_SCORE`
- `src/app/features/billing/constants/billing-activation.constants.ts` — add the bullet to premium feature list
- `src/app/features/billing/components/billing-current-plan-card/billing-current-plan-card.component.ts` (or wherever pricing plans are defined) — add Job Fit bullet to both freemium + premium pricing card data
- `src/app/features/billing/components/current-usage-card/current-usage-card.component.ts` — add gradient / color-class branches for `job_relevance_score`
- `src/app/features/tailor-apply/tailor-apply-modal.component.ts` + `.html` — detect `verdict === 'unavailable'` from relevance pre-check; if so, hide the Job Fit step, render an inline banner explaining the cap, advance straight to template step

**Website (`ats-fit-website`) — modified:**
- `src/index.html` — add a "Job Fit Score" bullet to both Freemium and Pro pricing cards (around lines 829-918)

---

## Task 0: Branch confirmation & doc grounding

**path:** all three repo roots
**intent:** Reuse the existing in-flight branches (`feat/be-owned-application-tracking` already open on BE + FE; the website ride-along is on whichever branch it currently sits) so this quota work merges as part of the same PR set. Read the four mandatory docs.
**verify:** `git branch --show-current` prints the existing branch name in each repo (no new branch created).
**agency:** `Git Workflow Master`
**docs:** `.ai/rules.md`, `.ai/workflow.md`, `docs/CONVENTIONS.md`, `docs/API-PATTERNS.md` (BE repo)

- [ ] **Step 1: Confirm current branches**

```bash
git -C /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend branch --show-current
git -C /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend branch --show-current
git -C /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-website branch --show-current
```

Expected: BE + FE on `feat/be-owned-application-tracking`. Website on whichever branch it currently sits (most likely `master`, optionally a sibling). **Do NOT create new branches** — this work rides on top of the existing in-flight feature branches.

- [ ] **Step 2: Read the four mandatory docs in the BE repo**

```bash
sed -n '1,200p' /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend/.ai/rules.md
sed -n '1,200p' /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend/.ai/workflow.md
sed -n '1,200p' /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend/docs/CONVENTIONS.md
sed -n '1,200p' /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend/docs/API-PATTERNS.md
```

Expected: confirm migration / module / rate-limit conventions. **Do not commit yet.**

---

## Task 1: Add `JOB_RELEVANCE_SCORE` to BE `FeatureType` enum

**path:** `src/database/entities/usage-tracking.entity.ts`
**intent:** Introduce the new feature-type value in the TS enum so the rest of the BE code can reference it.
**verify:** `npm run build && npm run lint` exit 0 on both.
**agency:** `Backend Architect`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Edit the enum**

In `src/database/entities/usage-tracking.entity.ts`, replace the enum declaration with:

```typescript
export enum FeatureType {
  RESUME_GENERATION = 'resume_generation',
  JOB_APPLICATION_TRACKING = 'job_application_tracking',
  COVER_LETTER = 'cover_letter',
  RESUME_BATCH_GENERATION = 'resume_batch_generation',
  JOB_RELEVANCE_SCORE = 'job_relevance_score',
}
```

- [ ] **Step 2: Build + lint**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run build && npm run lint
```

Expected: both exit 0. (Reviewer note: this introduces a new enum value that the Postgres enum types do not yet know about. Tasks 2-3 add the DB-side change. Build alone won't fail.)

---

## Task 2: Migration — ALTER TYPE + seed `rate_limit_configs`

**path:** `src/database/migrations/1815200000000-AddJobRelevanceScoreFeatureType.ts`
**intent:** Extend the two Postgres enums (`usage_tracking_feature_type_enum`, `rate_limit_configs_feature_type_enum`) to include `'job_relevance_score'`, then seed the plan-level limits (10 freemium, 100 premium, 0 guest).
**verify:** `npm run build && npm run lint` exit 0; `npm run migration:run` applies cleanly against local DB; `SELECT * FROM rate_limit_configs WHERE feature_type='job_relevance_score'` returns 3 rows.
**agency:** `Database Optimizer`
**docs:** `docs/CONVENTIONS.md`, `src/database/migrations-archive/1762793059000-AddCoverLetterFeatureType.ts` (reference pattern)

- [ ] **Step 1: Read the reference pattern**

```bash
sed -n '1,60p' /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend/src/database/migrations-archive/1762793059000-AddCoverLetterFeatureType.ts
```

- [ ] **Step 2: Create the migration**

Create `src/database/migrations/1815200000000-AddJobRelevanceScoreFeatureType.ts` with EXACTLY this content:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds JOB_RELEVANCE_SCORE as a first-class metered feature.
 *
 * Quota model — Approach F (shared pool, graceful degradation):
 *   FREEMIUM / job_relevance_score → 10 per month
 *   PREMIUM  / job_relevance_score → 100 per month
 *   GUEST    / job_relevance_score → 0  (not available — guests can't use the feature)
 *
 * Both the standalone POST /resume-tailoring/relevance endpoint AND the
 * orchestrator's internal call (inside generateOptimizedResume) consume
 * from this pool. Cache hits are free (no LLM call → service skips
 * recordUsage). When exhausted, the orchestrator returns the existing
 * UNAVAILABLE verdict sentinel with reason QUOTA_EXHAUSTED so the FE can
 * skip the Job Fit step in the stepper without blocking tailoring.
 */
export class AddJobRelevanceScoreFeatureType1815200000000
  implements MigrationInterface
{
  name = 'AddJobRelevanceScoreFeatureType1815200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Phase 1: commit TypeORM's open transaction so ALTER TYPE can run
    //          (Postgres requires enum extensions to live outside any TX).
    await queryRunner.commitTransaction();

    await queryRunner.query(
      `ALTER TYPE "public"."usage_tracking_feature_type_enum" ADD VALUE IF NOT EXISTS 'job_relevance_score'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."rate_limit_configs_feature_type_enum" ADD VALUE IF NOT EXISTS 'job_relevance_score'`,
    );

    // Phase 2: open a fresh transaction for the seed INSERTs.
    await queryRunner.startTransaction();

    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('freemium', 'registered', 'job_relevance_score', 10, true, 'Job-fit relevance previews for freemium users')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );
    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('premium', 'registered', 'job_relevance_score', 100, true, 'Job-fit relevance previews for premium users')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );
    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('freemium', 'guest', 'job_relevance_score', 0, true, 'Job-fit relevance not available to guests')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "rate_limit_configs" WHERE "feature_type" = 'job_relevance_score'`,
    );
    // NOTE: PostgreSQL does not support DROP VALUE on an enum.
    // The 'job_relevance_score' value remains in the enum types after rollback;
    // this is harmless — orphan enum values do not affect existing rows.
  }
}
```

- [ ] **Step 3: Build + lint**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run build && npm run lint
```

Expected: both exit 0.

- [ ] **Step 4: Apply migration locally**

```bash
npm run migration:run
```

Expected: `AddJobRelevanceScoreFeatureType1815200000000 has been executed successfully`.

- [ ] **Step 5: Verify seed rows landed**

```bash
docker exec ats-fit-postgres-dev psql -U postgres -d ats_fit -c "
SELECT plan, user_type, feature_type, monthly_limit, is_active
FROM rate_limit_configs
WHERE feature_type = 'job_relevance_score'
ORDER BY plan, user_type;
"
```

Expected: 3 rows — `(freemium, guest, 0)`, `(freemium, registered, 10)`, `(premium, registered, 100)`.

---

## Task 3: Add `QUOTA_EXHAUSTED` to `JobRelevanceSkipReason`

**path:** `src/modules/job-relevance/enums/job-relevance-skip-reason.enum.ts`
**intent:** Introduce a new skip reason so the orchestrator-internal call can communicate "I skipped because quota was exhausted" distinctly from existing reasons (feature disabled, no profile, empty profile).
**verify:** `npm run build && npm run lint` exit 0.
**agency:** `Backend Architect`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Read existing skip reasons to keep style consistent**

```bash
sed -n '1,40p' /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend/src/modules/job-relevance/enums/job-relevance-skip-reason.enum.ts
```

- [ ] **Step 2: Add the new value**

Append `QUOTA_EXHAUSTED = 'quota_exhausted'` to the enum, preserving the existing entries verbatim. For example, if the file currently looks like:

```typescript
export enum JobRelevanceSkipReason {
  FEATURE_DISABLED = 'feature_disabled',
  NO_PROFILE = 'no_profile',
  EMPTY_PROFILE = 'empty_profile',
}
```

Replace with:

```typescript
export enum JobRelevanceSkipReason {
  FEATURE_DISABLED = 'feature_disabled',
  NO_PROFILE = 'no_profile',
  EMPTY_PROFILE = 'empty_profile',
  /**
   * The user has consumed all their JOB_RELEVANCE_SCORE quota for the
   * current monthly period. Standalone /relevance returns 403; the
   * orchestrator-internal call sets this on `unavailableReason` so the
   * FE can hide the Fit Score step gracefully instead of failing.
   */
  QUOTA_EXHAUSTED = 'quota_exhausted',
}
```

- [ ] **Step 3: Build + lint**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 4: Service-owned quota gate inside `JobRelevanceService.score`

**path:** `src/modules/job-relevance/job-relevance.service.ts`, `src/modules/job-relevance/job-relevance.module.ts`
**intent:** Move quota check + usage recording inside the service so both callers (standalone endpoint + orchestrator-internal) bill correctly without duplicating logic. When quota is exhausted, return the existing UNAVAILABLE sentinel with `unavailableReason: QUOTA_EXHAUSTED` (callers handle it the same way they handle FEATURE_DISABLED today).
**verify:** `npm run build && npm run lint` exit 0 on both.
**agency:** `Backend Architect`
**docs:** `docs/ERROR-HANDLING.md`, `docs/CONVENTIONS.md`, existing `handleSkipped` + `buildSkipped` pattern in `job-relevance.service.ts`

- [ ] **Step 1: Wire `RateLimitModule` into `JobRelevanceModule`**

In `src/modules/job-relevance/job-relevance.module.ts`, add to imports:

```typescript
import { RateLimitModule } from '../rate-limit/rate-limit.module';

@Module({
  imports: [
    // ...existing imports
    RateLimitModule,
  ],
  // ...
})
export class JobRelevanceModule {}
```

- [ ] **Step 2: Inject `RateLimitService` into `JobRelevanceService`**

In `src/modules/job-relevance/job-relevance.service.ts`:

```typescript
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { FeatureType } from '../../database/entities/usage-tracking.entity';
// ...

constructor(
  // ...existing injected dependencies
  private readonly rateLimit: RateLimitService,
) {}
```

- [ ] **Step 3: Add quota gate at the top of `score()` (after profile-source checks, before cache check)**

Locate `score()` (around lines 25-50 of the service). Right after the existing profile-source guards and BEFORE the cache lookup, insert:

```typescript
    // Quota gate — applies uniformly to both callers (standalone /relevance
    // endpoint and the orchestrator-internal call). Cache hits never burn
    // quota (they bypass the LLM), so we let cached responses through even
    // when the bucket is empty. Skipped-only when this is a NEW LLM
    // computation request and the user is out.
    //
    // Guests (no userId) are gated to the FREEMIUM/guest config (0/month)
    // by RateLimitService directly — they never pass this check.
    if (input.userId) {
      const usage = await this.rateLimit.checkRateLimit(
        { userId: input.userId } as never,
        FeatureType.JOB_RELEVANCE_SCORE,
      );
      // Cache may still serve a free hit; defer the hard check until after
      // the cache lookup to avoid blocking repeat previews of the same JD.
      // Stash the usage info for the post-cache decision.
      (input as unknown as { _quotaRemaining?: number })._quotaRemaining =
        usage.remaining;
    }
```

Then, AFTER the cache-hit branch (which returns early with `engine: CACHE_HIT`) and BEFORE the fast-path / LLM call, add:

```typescript
    const remainingBefore =
      (input as unknown as { _quotaRemaining?: number })._quotaRemaining ?? Infinity;
    if (remainingBefore <= 0) {
      // No LLM call possible — surface the existing UNAVAILABLE sentinel
      // with a new reason so callers can render the skipped-state UI.
      return this.handleSkipped(input, JobRelevanceSkipReason.QUOTA_EXHAUSTED);
    }
```

- [ ] **Step 4: Record usage on successful LLM calls**

In `score()`, AFTER the line `await this.cache.set(cacheKey, final);` (around lines 79-81 — only fires when `engine === LLM`), insert:

```typescript
      // Record usage only when we actually called the LLM. Cache hits and
      // fast-path skips do not consume quota — they cost us nothing and
      // should not count against the user.
      if (input.userId) {
        try {
          await this.rateLimit.recordUsage(
            { userId: input.userId } as never,
            FeatureType.JOB_RELEVANCE_SCORE,
          );
        } catch (recordError) {
          this.logger.warn(
            `Failed to record JOB_RELEVANCE_SCORE usage for user ${input.userId}: ${(recordError as Error).message}`,
          );
        }
      }
```

- [ ] **Step 5: Confirm `handleSkipped` already populates `unavailableReason` via `buildSkipped`**

Open `job-relevance.service.ts` and inspect `buildSkipped` (around lines 130-165). It already sets `unavailableReason: reason` on the result. No further change needed — the new `QUOTA_EXHAUSTED` reason flows through automatically.

- [ ] **Step 6: Build + lint**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 5: Add `@RateLimitFeature` to the standalone `/relevance` endpoint

**path:** `src/modules/resume-tailoring/resume-tailoring.controller.ts`
**intent:** Standalone HTTP endpoint returns 403 when quota is exhausted (consistent with how RESUME_GENERATION + COVER_LETTER endpoints behave). Do NOT add `UsageTrackingInterceptor` — the service now owns usage recording (Task 4), and interceptor + service would double-count.
**verify:** `npm run build && npm run lint` exit 0; manual smoke verifies a 403 once quota is at 0.
**agency:** `Backend Architect`
**docs:** `docs/API-PATTERNS.md`, existing decorator usage on the same controller (line 192 for RESUME_GENERATION)

- [ ] **Step 1: Add the decorator to `checkJobRelevance`**

In `src/modules/resume-tailoring/resume-tailoring.controller.ts`, locate the `@Post('relevance')` block (around line 312). Add `@RateLimitFeature(FeatureType.JOB_RELEVANCE_SCORE)` immediately after `@HttpCode(HttpStatus.OK)`, mirroring the pattern used by `generateTailoredResume`. The block should look like:

```typescript
  @Post('relevance')
  @HttpCode(HttpStatus.OK)
  @TransformUserContext()
  @RateLimitFeature(FeatureType.JOB_RELEVANCE_SCORE)
  @UseInterceptors(FileInterceptor('resumeFile'), ValidationLoggingInterceptor)
  async checkJobRelevance(
    @Body() dto: CheckJobRelevanceDto,
    // ...rest of signature unchanged
  ): Promise<{ relevance: unknown }> {
    // ...body unchanged
  }
```

Do NOT add `UsageTrackingInterceptor` to this method — `JobRelevanceService.score()` records usage internally (Task 4).

- [ ] **Step 2: Build + lint**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 6: Update rate-limit JSDoc canonical-set comment

**path:** `src/modules/rate-limit/rate-limit.service.ts`
**intent:** The service has a long JSDoc block describing the canonical limit set. Keep it accurate — code reviewers rely on it as truth.
**verify:** Grep confirms the new entry appears in the JSDoc; build passes.
**agency:** `Backend Architect`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Locate the JSDoc canonical-set block**

```bash
grep -n "Canonical set\|FREEMIUM / RESUME_GENERATION\|PREMIUM  / RESUME_BATCH" \
  /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend/src/modules/rate-limit/rate-limit.service.ts
```

- [ ] **Step 2: Add two lines to the canonical set documentation**

In `src/modules/rate-limit/rate-limit.service.ts`, find the JSDoc block listing "Canonical set" (around the line that has `FREEMIUM / RESUME_GENERATION → 3`). Add immediately after the `PREMIUM / RESUME_BATCH_GENERATION` entry:

```
   *   FREEMIUM / JOB_RELEVANCE_SCORE      → 10  fit checks / month
   *   PREMIUM  / JOB_RELEVANCE_SCORE      → 100 fit checks / month
```

Also extend the shared-pool semantics block, if present, with:

```
   *   - Standalone /relevance call → +1 JOB_RELEVANCE_SCORE
   *   - Orchestrator-internal call during tailoring → +1 JOB_RELEVANCE_SCORE
   *     (so a preview-then-tailor against the same JD costs 1 total — the
   *     second call is a cache hit, which does not record usage)
```

- [ ] **Step 3: Build + lint**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 7: FE — add `JOB_RELEVANCE_SCORE` to FeatureType enum

**path:** `ats-fit-frontend/src/app/core/enums/feature-type.enum.ts`
**intent:** Mirror the BE enum so the FE can reference the new feature in quota state + UI.
**verify:** `npm run build && npm run lint` exit 0 in the FE repo.
**agency:** `Frontend Developer`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Edit the enum**

Replace the contents of `src/app/core/enums/feature-type.enum.ts` with:

```typescript
export enum FeatureType {
  RESUME_GENERATION = 'resume_generation',
  COVER_LETTER = 'cover_letter',
  RESUME_BATCH_GENERATION = 'resume_batch_generation',
  JOB_APPLICATION_TRACKING = 'job_application_tracking',
  JOB_RELEVANCE_SCORE = 'job_relevance_score',
}
```

- [ ] **Step 2: Build + lint**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend && npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 8: FE — add user-facing title for the new feature

**path:** `ats-fit-frontend/src/app/features/dashboard/constants/feature-title.constant.ts`
**intent:** The dashboard's current-usage card derives its display title from this map. Without the new entry, the Job Fit usage card would render an empty title.
**verify:** `npm run build && npm run lint` exit 0 in the FE repo.
**agency:** `Frontend Developer`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Edit the constant**

Replace the file contents with:

```typescript
export const FeatureTitles = {
  resume_generation: 'Resume Generation',
  job_relevance_score: 'Job Fit Scoring',
};
```

- [ ] **Step 2: Build + lint**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend && npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 9: FE — extend `CurrentUsageCardComponent` color branches

**path:** `ats-fit-frontend/src/app/features/billing/components/current-usage-card/current-usage-card.component.ts`
**intent:** Reuse the existing usage card for the new feature with a distinct gradient / accent so users can tell the two quotas apart at a glance.
**verify:** FE build + lint exit 0.
**agency:** `Frontend Developer`
**docs:** `docs/CONVENTIONS.md` (Tailwind class conventions)

- [ ] **Step 1: Update the three switch statements**

Replace the file with:

```typescript
import { NgClass } from '@angular/common';
import { Component, input } from '@angular/core';
import { FeatureUsage } from '@core/models/user/feature-usage.model';
import { FeatureTitles } from '@features/dashboard/constants/feature-title.constant';

@Component({
  selector: 'app-current-usage-card',
  imports: [NgClass],
  templateUrl: './current-usage-card.component.html',
  styleUrl: './current-usage-card.component.scss',
})
export class CurrentUsageCardComponent {
  public usage = input<FeatureUsage>();

  public featureTitles = FeatureTitles;

  public getCardIconGradient(feature: string | undefined): string {
    switch (feature) {
      case 'resume_generation':
        return 'from-emerald-50 to-teal-50 border-emerald-200';
      case 'job_relevance_score':
        return 'from-sky-50 to-indigo-50 border-sky-200';
      default:
        return 'from-emerald-50 to-teal-50 border-emerald-200';
    }
  }

  public getTitleColorClass(feature: string | undefined): string {
    switch (feature) {
      case 'resume_generation':
        return 'text-emerald-700';
      case 'job_relevance_score':
        return 'text-sky-700';
      default:
        return 'text-emerald-700';
    }
  }

  public getValueColorClass(feature: string | undefined): string {
    switch (feature) {
      case 'resume_generation':
        return 'text-emerald-900';
      case 'job_relevance_score':
        return 'text-sky-900';
      default:
        return 'text-emerald-900';
    }
  }

  getTitle(): string {
    const feature = this.usage()?.feature;
    if (feature !== undefined && feature in FeatureTitles) {
      return FeatureTitles[feature as keyof typeof FeatureTitles];
    }
    return '';
  }
}
```

- [ ] **Step 2: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 10: FE — dashboard hero shows the Job Fit quota strip

**path:** `ats-fit-frontend/src/app/shared/components/dashboard-hero/dashboard-hero.component.ts` + `.html`
**intent:** Surface a second quota strip next to the existing "Tailored resumes" strip so users can see their fit-check budget at a glance.
**verify:** FE build + lint exit 0. Manual: visit `/dashboard`, confirm both strips visible after the user data loads.
**agency:** `Frontend Developer`
**docs:** existing dashboard-hero.component.ts pattern

- [ ] **Step 1: Edit the component to expose both quotas**

Replace the `tailoredResumesQuota` block in `dashboard-hero.component.ts` with both:

```typescript
  /**
   * Tailored-resume quota (RESUME_GENERATION). Single + batch share this
   * pool, so we surface one number for "how many resumes I can still
   * tailor this month".
   */
  readonly tailoredResumesQuota = this.quotaState.quotaFor(
    FeatureType.RESUME_GENERATION,
  );

  /**
   * Job-fit-scoring quota (JOB_RELEVANCE_SCORE). Shared between standalone
   * fit-check previews and the orchestrator-internal call inside tailoring.
   * Cache hits don't burn quota. When exhausted, tailoring still works but
   * skips the Job Fit step in the modal.
   */
  readonly jobFitQuota = this.quotaState.quotaFor(
    FeatureType.JOB_RELEVANCE_SCORE,
  );

  readonly quotaStatus = computed(() => {
    const tailorStatus = this.tailoredResumesQuota()?.status ?? 'healthy';
    const fitStatus = this.jobFitQuota()?.status ?? 'healthy';
    // Worst-of-N rendering — single accent color drives the hero band.
    if (tailorStatus === 'exhausted' || fitStatus === 'exhausted') return 'exhausted';
    if (tailorStatus === 'approaching' || fitStatus === 'approaching') return 'approaching';
    return 'healthy';
  });
```

- [ ] **Step 2: Edit the template to render the second strip**

In `dashboard-hero.component.html`, locate the existing tailored-resumes usage block and duplicate it for the fit-check quota. Render only when `jobFitQuota()` is non-null. Reuse the existing CSS structure. For example, if the existing block looks like:

```html
@if (tailoredResumesQuota(); as q) {
  <div class="usage-strip">
    <span class="text-sm font-medium text-slate-700">Tailored resumes</span>
    <span class="text-sm font-semibold">{{ q.used }} of {{ q.allowed }}</span>
    <!-- progress bar -->
  </div>
}
```

Add an analogous block immediately after:

```html
@if (jobFitQuota(); as q) {
  <div class="usage-strip">
    <span class="text-sm font-medium text-slate-700">Job-fit checks</span>
    <span class="text-sm font-semibold">{{ q.used }} of {{ q.allowed }}</span>
    <!-- reuse the same progress-bar markup as the row above, with the
         width binding `[style.width.%]="q.percentage"`. -->
  </div>
}
```

(Use the exact CSS class names + markup from the existing row — duplicate the structure, change only the label and signal reference.)

- [ ] **Step 3: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 11: FE — pricing-card feature list updates

**path:** `ats-fit-frontend/src/app/features/billing/constants/billing-activation.constants.ts` + the pricing-plan data source (the constants file that drives the in-app pricing cards)
**intent:** Add a "10 job-fit checks/month" bullet (or "100" for premium) to the in-app pricing cards' feature lists so users see the new metered feature when reviewing plans.
**verify:** FE build + lint exit 0. Manual: open the billing page, both cards display the new bullet.
**agency:** `Frontend Developer`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Locate the pricing-card data sources**

```bash
grep -rn "tailored resumes\|cover letters\|features = \[" \
  /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend/src/app/features/billing/ \
  --include="*.ts" | head -10
```

- [ ] **Step 2: Add the bullet to both freemium and premium feature lists**

In whichever file declares the plan feature arrays (likely `billing-activation.constants.ts` or a sibling `pricing-plans.constant.ts`), add to the FREEMIUM feature list:

```typescript
'10 job-fit checks / month',
```

And to the PREMIUM feature list:

```typescript
'100 job-fit checks / month',
```

Place each entry just after the corresponding "X tailored resumes / month" entry so the visual order on the card reads naturally (tailoring above fit-checks, since fit-checks are a subordinate feature).

- [ ] **Step 3: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 12: FE — tailor-apply modal handles graceful skip

**path:** `ats-fit-frontend/src/app/features/tailor-apply/tailor-apply-modal.component.ts` + `.html`
**intent:** When the relevance pre-check returns `verdict === 'unavailable'` AND `unavailableReason === 'quota_exhausted'`, skip the "Job Fit" step in the stepper, render an inline upgrade banner, and proceed directly to the template step. Tailoring itself stays functional — the user just doesn't get the pre-check.
**verify:** FE build + lint exit 0. Manual: set the freemium relevance quota to 0 (via DB), submit a tailor, confirm the Job Fit step is hidden, a banner explains why, and the user can still complete tailoring.
**agency:** `Frontend Developer`
**docs:** existing stepper logic in `tailor-apply-modal.component.ts`

- [ ] **Step 1: Inspect the existing relevance handling**

```bash
grep -n "checkJobRelevance\|currentStep\|relevance\|unavailable" \
  /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend/src/app/features/tailor-apply/tailor-apply-modal.component.ts | head -20
```

- [ ] **Step 2: Add a signal that tracks the skipped-state**

In the component class, near the existing signals (e.g. `currentStep`, `tailoredResume`):

```typescript
  /**
   * True when the BE returned `verdict: 'unavailable'` with
   * `unavailableReason: 'quota_exhausted'` for this run. The Job Fit
   * step is hidden and a banner replaces it; tailoring stays available.
   */
  readonly jobFitQuotaExhausted = signal(false);
```

- [ ] **Step 3: In the relevance-pre-check callback, detect the sentinel**

Wherever the component currently calls the `/relevance` endpoint and processes the response, replace the result-handling branch with logic shaped like:

```typescript
this.relevanceService.checkRelevance(payload).subscribe({
  next: (response) => {
    const relevance = response.relevance as { verdict?: string; unavailableReason?: string };
    if (
      relevance?.verdict === 'unavailable' &&
      relevance?.unavailableReason === 'quota_exhausted'
    ) {
      // Graceful degradation — surface the banner and skip the Fit Score step.
      this.jobFitQuotaExhausted.set(true);
      this.currentStep.set(this.STEP_TEMPLATE);
      return;
    }
    // ...existing handling for verdict in {low, medium, high} unchanged
  },
  error: (err) => {
    // ...existing error handling unchanged
  },
});
```

(Use the literal step constant your component already declares for the Template step — if it's `3`, use `3`; if it's an enum/symbol, use that.)

- [ ] **Step 4: Render the banner in the template**

In `tailor-apply-modal.component.html`, wherever the Job Fit step's content lives, wrap it in a guard:

```html
@if (jobFitQuotaExhausted()) {
  <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 flex flex-col gap-2">
    <strong class="text-amber-900">Job Fit Scoring paused this month.</strong>
    <p>
      You've used all your monthly fit-check previews. Tailoring still works —
      we'll generate your tailored resume without the fit preview. Your fit
      checks reset at the start of next month.
    </p>
    <a class="text-amber-900 underline underline-offset-2" routerLink="/billing">
      Upgrade for more fit checks →
    </a>
  </div>
} @else {
  <!-- existing Job Fit step content unchanged -->
}
```

- [ ] **Step 5: Reset the signal on modal close / re-open**

If the modal can be re-opened without a full destroy (e.g. user dismisses, returns), reset `jobFitQuotaExhausted` to `false` in whatever lifecycle hook handles re-init (typically `ngOnInit` or a manual `reset()` method).

- [ ] **Step 6: Build + lint**

```bash
npm run build && npm run lint
```

Expected: both exit 0.

---

## Task 13: Website — Job Fit bullet in pricing cards

**path:** `ats-fit-website/src/index.html`
**intent:** Public pricing page reflects the new metered feature so visitors see what the plan includes before signing up.
**verify:** `npm run build` (if defined) succeeds; both pricing cards display the new bullet when the page is rendered.
**agency:** `Frontend Developer`
**docs:** `ats-fit-website/CLAUDE.md`

- [ ] **Step 1: Inspect the existing freemium card**

```bash
sed -n '829,865p' /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-website/src/index.html
```

- [ ] **Step 2: Insert a new `<li>` into the Freemium plan's feature list**

In `ats-fit-website/src/index.html`, find the Freemium plan `<ul class="space-y-3 mb-8">` (around line 838). Add this `<li>` immediately after the existing "3 tailored resumes/month" entry:

```html
              <li class="flex items-start gap-3 text-slate-700">
                <span class="text-green-600 font-bold mt-0.5">✓</span>
                <span>10 job-fit checks/month</span>
              </li>
```

- [ ] **Step 3: Insert the corresponding bullet into the Pro card**

Find the Pro plan `<ul class="space-y-3 mb-8">` (around line 879). Add this `<li>` immediately after the existing "30 tailored resumes/month" entry:

```html
              <li class="flex items-start gap-3 text-slate-700">
                <span class="text-blue-600 font-bold mt-0.5">✓</span>
                <span>100 job-fit checks/month</span>
              </li>
```

- [ ] **Step 4: Build (if the website has a build step)**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-website && \
  (test -f package.json && npm run build || echo "no build step required")
```

Expected: exit 0 or "no build step required".

---

## Task 14: End-to-end manual verification

**path:** all three repos
**intent:** Exercise every dimension of the new feature against live local stacks: standalone preview consumes quota; cache hit is free; orchestrator skips gracefully when exhausted; all four UI surfaces show correct values.
**verify:** Every row in the checklist below passes.
**agency:** `Evidence Collector`
**docs:** `docs/TESTING-STRATEGY.md`

- [ ] **Step 1: Start both stacks**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run start:dev &
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend && npm start &
```

- [ ] **Step 2: Take a baseline of relevance usage for the test user**

```bash
TEST_USER='<your test user uuid>'
docker exec ats-fit-postgres-dev psql -U postgres -d ats_fit -c "
SELECT feature_type, usage_count, month, year
FROM usage_tracking
WHERE user_id = '$TEST_USER'
ORDER BY feature_type;
"
```

Record the current `job_relevance_score` count (or 0 if absent).

- [ ] **Step 3: Standalone preview burns +1 quota**

In the browser, open the tailor modal → enter a JD → submit. After the Job Fit step renders, re-run the query above.

Expected: `job_relevance_score.usage_count` incremented by 1.

- [ ] **Step 4: Cache hit is free**

Without closing the modal, go back to Job Details → submit the **same** JD again. Re-run the query.

Expected: count is unchanged (cache hit). BE logs confirm `engine: cache-hit`.

- [ ] **Step 5: Orchestrator-internal call after fresh preview is also a cache hit**

Complete the tailoring (click through to template, generate). Re-run the query.

Expected: count is still unchanged (the orchestrator-internal relevance call hit the same cache key, no LLM call, no usage recorded). `pre_generation_relevance->>'engine'` on the resulting `resume_generations` row reads `cache-hit`.

- [ ] **Step 6: Exhaust the quota**

Bump the usage count to the cap directly via SQL:

```bash
docker exec ats-fit-postgres-dev psql -U postgres -d ats_fit -c "
INSERT INTO usage_tracking (user_id, feature_type, month, year, usage_count, last_used_at)
VALUES ('$TEST_USER', 'job_relevance_score', EXTRACT(MONTH FROM NOW())::int, EXTRACT(YEAR FROM NOW())::int, 10, NOW())
ON CONFLICT (user_id, feature_type, month, year)
DO UPDATE SET usage_count = 10, last_used_at = NOW();
"
```

(Adjust the conflict clause to match the actual unique-index column set on `usage_tracking`. If the table lacks a unique index, DELETE then INSERT.)

- [ ] **Step 7: Standalone preview returns 403**

Trigger a fresh `/relevance` call (different JD so no cache hit).

Expected: BE returns 403 with the standard rate-limit error envelope. FE shows the upgrade banner / toast (your existing 403 handler).

- [ ] **Step 8: Tailoring still works — fit step is gracefully skipped**

In the same exhausted state, attempt to tailor a different new JD.

Expected: tailor-apply modal renders the amber "Job Fit Scoring paused this month" banner. The user can click through to Template and complete tailoring. `resume_generations` row has `pre_generation_relevance->>'verdict' = 'unavailable'` and `unavailableReason = 'quota_exhausted'`.

- [ ] **Step 9: Dashboard chip reflects exhausted state**

Reload `/dashboard`. The Job-fit checks usage strip shows "10 of 10" with the exhausted styling.

- [ ] **Step 10: Pricing card displays new bullets — both apps**

Visit the billing page in `ats-fit-frontend` → both plan cards show the new "X job-fit checks/month" line.
Open `ats-fit-website/src/index.html` (or `http://localhost:<port>` after `npm run build && serve dist`) → Freemium and Pro cards both show the new line.

---

## Task 15: Code review pass

**path:** all three repos
**intent:** Independent reviewer audits the whole branch set for correctness, SRP, observability, and pricing-copy consistency.
**verify:** Reviewer signs off; all blockers resolved on the branches.
**agency:** `Code Reviewer`
**docs:** `.ai/rules.md`, `docs/CONVENTIONS.md`, `docs/ERROR-HANDLING.md`, `docs/API-PATTERNS.md`

- [ ] **Step 1: Self-diff sweep across all three repos**

```bash
git -C /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend diff master --stat
git -C /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend diff master --stat
git -C /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-website diff master --stat
```

Confirm only the files listed in the File Map appear.

- [ ] **Step 2: Dispatch the Code Reviewer agent**

```text
Task(subagent_type="Code Reviewer", prompt="Review feat/job-relevance-quota across three repos (ats-fit-backend, ats-fit-frontend, ats-fit-website) for the JOB_RELEVANCE_SCORE quota feature. Focus on: (1) double-counting risk between the @RateLimitFeature decorator and the new service-internal recordUsage call, (2) the order of the quota-gate vs cache-hit branch in JobRelevanceService.score (cache hits MUST be free), (3) the orchestrator-internal call's behavior when quota is exhausted (UNAVAILABLE sentinel with QUOTA_EXHAUSTED reason — NOT a thrown exception), (4) migration safety (ALTER TYPE outside transaction, idempotent seed inserts), (5) FE banner copy matches the pricing-card promise, (6) consistency of '10' / '100' numbers across BE seeds + FE pricing cards + website pricing cards. Report blockers + nits.")
```

- [ ] **Step 3: Address every blocker**

Fix on the same branches. **Still no commits at this stage** — fixes accumulate into the final commits in Task 16.

---

## Task 16: Single commits per repo + open PRs

**path:** GitHub
**intent:** Land the feature as one atomic commit per repo, push, open three PRs cross-linked in their descriptions.
**verify:** Three PRs open, CI green on each.
**agency:** `Jira Workflow Steward`
**docs:** `.ai/workflow.md`

- [ ] **Step 1: Stage + commit in the backend repo**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend
git status
git add src/database/migrations/1815200000000-AddJobRelevanceScoreFeatureType.ts \
        src/database/entities/usage-tracking.entity.ts \
        src/modules/job-relevance/enums/job-relevance-skip-reason.enum.ts \
        src/modules/job-relevance/job-relevance.service.ts \
        src/modules/job-relevance/job-relevance.module.ts \
        src/modules/resume-tailoring/resume-tailoring.controller.ts \
        src/modules/rate-limit/rate-limit.service.ts
git commit -m "$(cat <<'EOF'
feat(rate-limit): add JOB_RELEVANCE_SCORE metered feature (10 freemium / 100 premium)

Both the standalone POST /resume-tailoring/relevance endpoint and the
orchestrator's internal relevance call inside generateOptimizedResume now
consume from a shared JOB_RELEVANCE_SCORE quota pool. Cache hits are free
(no LLM call → no usage recorded), so a preview-then-tailor against the
same JD costs 1 total.

When the user has exhausted the pool:
- Standalone /relevance returns 403 via @RateLimitFeature (consistent with
  RESUME_GENERATION + COVER_LETTER).
- Orchestrator-internal call returns the existing UNAVAILABLE verdict
  sentinel with reason QUOTA_EXHAUSTED. The FE detects this and removes
  the Job Fit step from the tailor stepper — tailoring continues normally
  with an inline banner explaining why fit scoring is paused.

Usage recording lives inside JobRelevanceService.score (gated on
engine === LLM), so both callers bill correctly without duplicating logic.
The HTTP endpoint keeps @RateLimitFeature for the guard but drops
UsageTrackingInterceptor to avoid double-counting.

Seed limits per migration: freemium 10/month, premium 100/month, guest 0.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push -u origin feat/job-relevance-quota
```

- [ ] **Step 2: Stage + commit in the frontend app repo**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend
git status
git add src/app/core/enums/feature-type.enum.ts \
        src/app/features/dashboard/constants/feature-title.constant.ts \
        src/app/features/billing/components/current-usage-card/current-usage-card.component.ts \
        src/app/features/billing/constants/billing-activation.constants.ts \
        src/app/shared/components/dashboard-hero/dashboard-hero.component.ts \
        src/app/shared/components/dashboard-hero/dashboard-hero.component.html \
        src/app/features/tailor-apply/tailor-apply-modal.component.ts \
        src/app/features/tailor-apply/tailor-apply-modal.component.html
git commit -m "$(cat <<'EOF'
feat(quota): surface JOB_RELEVANCE_SCORE quota across dashboard, billing, tailor modal

- Adds the new FeatureType enum value mirroring the backend.
- Dashboard hero shows a second usage strip ('Job-fit checks: X of Y') next
  to the existing tailored-resume strip.
- Billing current-usage card supports the new feature via dedicated sky/
  indigo color branches and a 'Job Fit Scoring' title.
- Pricing cards list '10 job-fit checks / month' (freemium) and '100 /
  month' (premium) so users see what the plan includes.
- Tailor-apply modal detects the UNAVAILABLE + quota_exhausted sentinel
  from the relevance pre-check, hides the Job Fit step, and renders an
  inline 'paused this month' banner. Tailoring proceeds normally without
  the fit preview.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push -u origin feat/job-relevance-quota
```

- [ ] **Step 3: Stage + commit in the website repo**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-website
git status
git add src/index.html
git commit -m "$(cat <<'EOF'
content(pricing): add Job Fit Scoring to public pricing cards (10 / 100 per month)

Aligns the public marketing site with the new metered feature so visitors
see the full plan inclusions before signing up.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
git push -u origin feat/job-relevance-quota
```

- [ ] **Step 4: Open the three PRs**

```bash
cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend
gh pr create --title "feat(rate-limit): JOB_RELEVANCE_SCORE quota with graceful degradation" --body "$(cat <<'EOF'
## Summary
- Adds JOB_RELEVANCE_SCORE as a first-class metered feature (10 freemium / 100 premium).
- Shared quota pool between standalone /relevance preview and orchestrator-internal relevance call inside tailoring. Cache hits free.
- When exhausted, tailoring gracefully degrades — Fit Score step hidden, tailoring continues.

## Test plan
- [ ] `npm run build` clean
- [ ] Migration applies cleanly: `npm run migration:run`
- [ ] Standalone preview consumes +1 quota (fresh JD)
- [ ] Cache hit of same JD = 0 quota burned
- [ ] Tailoring after preview = 0 additional quota (orchestrator-internal hits cache)
- [ ] Exhausted standalone returns 403
- [ ] Exhausted tailoring continues, Fit Score step hidden, banner explains why
- [ ] `pre_generation_relevance->>'unavailableReason' = 'quota_exhausted'` on persisted row

## Companion PRs
- ats-fit-frontend: <link to FE PR>
- ats-fit-website: <link to website PR>
EOF
)"
```

Open the FE and website PRs similarly, cross-linking back to this one.

---

## Self-Review Checklist

- [x] Every task has `path`, `intent`, `verify`, `agency`, `docs`.
- [x] No `general-purpose` agent.
- [x] No `TBD` / `add appropriate X` placeholders — every code step shows the code.
- [x] No automated test tasks (per user directive).
- [x] No per-task commits — all commits batched into Task 16 (per user directive).
- [x] Single source of truth for metering: `JobRelevanceService.score` records usage; `@RateLimitFeature` only guards.
- [x] Spec coverage: quota model (10/100 separate pool), graceful degradation, all four UI surfaces (dashboard chip, profile usage card, tailor modal, pricing cards in two apps), cache-hit-is-free, orchestrator skip, migration + seed.
- [x] Numbers consistent across BE seeds, FE pricing cards, website pricing cards (10 / 100).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-job-relevance-quota.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review, fast iteration.
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints.

Which approach?
