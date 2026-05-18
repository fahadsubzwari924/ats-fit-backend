# Backend-Owned Job Application Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Per `.ai/CONTRACT.md`:** Every task below carries `path`, `intent`, `verify`, `agency`, `docs`. Use the Agency mapping from `.claude/agents/_index.json` — never `general-purpose`.
>
> **Scope note (user directive):** No automated tests are written in this plan. Verification relies on type-checking, linting, builds, migration runs, and explicit manual smoke tests. Commits are deferred to the final task — engineers should NOT commit between tasks.

**Goal:** Move job-application creation out of the frontend modal-close lifecycle and into the backend so every successful resume tailoring (single or batch) deterministically produces a `job_applications` row, eliminating the silent-drop bug where users see fewer tracked applications than they generated.

**Architecture:** Introduce a single backend write path — `JobApplicationService.trackTailoringApplication(...)` — invoked synchronously from the single-tailor orchestrator (after the pdf path succeeds) and from the batch processor (after `state='completed'`). Database enforces idempotency via a partial unique index on `job_applications.resume_generation_id`. Frontend modal-close auto-tracking is removed; the explicit "Track All" button becomes a passive "Tracked" badge because rows already exist server-side.

**Tech Stack:** NestJS 10 (backend), TypeORM (Postgres), Bull queues, Angular 18 standalone components (frontend).

**SOLID alignment:**
- **SRP:** `trackTailoringApplication` does one thing — turn a finished tailoring into a tracked application. `createJobApplication` keeps generic create semantics.
- **OCP:** New call sites extend behavior without modifying `createJobApplication`.
- **DIP:** Batch processor and resume-tailoring orchestrator depend on `JobApplicationService` abstraction, not on a concrete tracking implementation.
- **ISP:** New method has a narrow, purposeful signature (`userId`, `resumeGenerationId`, three text fields).

---

## File Map

**Backend — created:**
- `src/database/migrations/1815100000000-AddUniqueResumeGenerationOnJobApplications.ts` — partial unique index for idempotency
- `src/database/migrations/1815100100000-BackfillMissingTrackedApplications.ts` — one-time backfill for resumes that never produced a `job_application` row
- `src/modules/job-application/interfaces/track-tailoring-application.interface.ts` — input contract for the new service method

**Backend — modified:**
- `src/modules/job-application/job-application.service.ts` — add `trackTailoringApplication`
- `src/modules/job-application/job-application.module.ts` — export `JobApplicationService` for cross-module DI
- `src/modules/resume-tailoring/resume-tailoring.module.ts` — import `JobApplicationModule`
- `src/modules/resume-tailoring/resume-tailoring.controller.ts` — structured error logging in `generateTailoredResume` catch
- `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts` — call tracker after pdf success + per-stage structured error logging + try/catch around non-fatal side-effects
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.module.ts` — import `JobApplicationModule`
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.processor.ts` — call tracker after job completes + include `jobDescription` in SSE + structured stage-tagged error logging + guarded SSE emit + guarded secondary DB writes
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts` — include `jobDescription` in snapshot `toResult`

**Frontend — modified:**
- `src/app/features/tailor-apply/batch-tailoring-modal.component.ts` — remove `fireBatchTrackingInBackground`, simplify `close()`
- `src/app/features/tailor-apply/tailor-apply-modal.component.ts` — remove `fireTrackingInBackground` and `buildTrackingPayload`, simplify `closeModal()`
- `src/app/features/tailor-apply/components/batch-results/batch-results.component.ts` — convert `trackAllApplications` button into a passive "Tracked" affordance
- `src/app/features/tailor-apply/components/batch-results/batch-results.component.html` — update CTA label/state

---

## Task 0: Branch & doc grounding

**path:** `(repo root)`
**intent:** Spawn a feature branch off `master`, read the four mandatory docs so every later task has shared context.
**verify:** `git branch --show-current` prints the new branch name.
**agency:** `Git Workflow Master`
**docs:** `.ai/rules.md`, `.ai/workflow.md`, `docs/CONVENTIONS.md`, `docs/API-PATTERNS.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: Create feature branch**

```bash
git checkout master
git pull --ff-only
git checkout -b feat/be-owned-application-tracking
```

- [ ] **Step 2: Read the four docs once**

```bash
sed -n '1,200p' .ai/rules.md
sed -n '1,200p' .ai/workflow.md
sed -n '1,200p' docs/CONVENTIONS.md
sed -n '1,200p' docs/API-PATTERNS.md
```

Expected: confirm conventions for module exports, migration timestamps, error-handling style, and Logger usage. **Do not commit yet.**

---

## Task 1: Partial unique index migration

**path:** `src/database/migrations/1815100000000-AddUniqueResumeGenerationOnJobApplications.ts`
**intent:** Enforce one `job_applications` row per `resume_generation_id` at the DB level so backend tracker is idempotent under retries / double-writes.
**verify:** `npm run migration:run` applies cleanly; `\d job_applications` in psql shows the new index marked `UNIQUE` with `WHERE (resume_generation_id IS NOT NULL)`.
**agency:** `Database Optimizer`
**docs:** `docs/CONVENTIONS.md` (migration section), `docs/ARCHITECTURE.md` (data layer)

- [ ] **Step 1: Read the latest migration for pattern reference**

```bash
sed -n '1,60p' src/database/migrations/1815000000000-AddPreGenerationRelevanceToResumeGenerations.ts
```

- [ ] **Step 2: Create the migration file**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUniqueResumeGenerationOnJobApplications1815100000000
  implements MigrationInterface
{
  name = 'AddUniqueResumeGenerationOnJobApplications1815100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applications_resume_generation_id
        ON job_applications (resume_generation_id)
        WHERE resume_generation_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_job_applications_resume_generation_id`,
    );
  }
}
```

- [ ] **Step 3: Run migration locally**

```bash
npm run migration:run
```

Expected: migration logs `migration AddUniqueResumeGenerationOnJobApplications1815100000000 has been executed successfully`.

- [ ] **Step 4: Verify the index in psql**

```bash
psql "$LOCAL_DATABASE_URL" -c "\d job_applications" | grep uq_job_applications_resume_generation_id
```

Expected output contains `uq_job_applications_resume_generation_id` with `UNIQUE` and `WHERE (resume_generation_id IS NOT NULL)`.

---

## Task 2: `ITrackTailoringApplication` interface

**path:** `src/modules/job-application/interfaces/track-tailoring-application.interface.ts`
**intent:** Define the narrow input contract the new service method consumes so call sites stay decoupled from `ICreateJobApplication`.
**verify:** `npx tsc --noEmit` reports zero errors.
**agency:** `Backend Architect`
**docs:** `docs/CONVENTIONS.md` (interface naming), `src/modules/job-application/interfaces/job-application.interface.ts` (existing patterns)

- [ ] **Step 1: Create the interface file**

```typescript
/**
 * Input contract for `JobApplicationService.trackTailoringApplication`.
 *
 * Both the single-tailoring orchestrator and the batch processor have these
 * fields already in scope when a resume generation completes successfully,
 * so the service does not re-read the resume_generations row.
 */
export interface ITrackTailoringApplication {
  userId: string;
  resumeGenerationId: string;
  companyName: string;
  jobPosition: string;
  jobDescription: string;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors.

---

## Task 3: Implement `trackTailoringApplication` on `JobApplicationService`

**path:** `src/modules/job-application/job-application.service.ts`
**intent:** Idempotent insert keyed by `resume_generation_id`. Reuses `createJobApplication` for the underlying write. Catches Postgres `23505` on the new unique index → returns `null` (already tracked). Other failures rethrow.
**verify:** `npm run build` succeeds; the method appears in the compiled `dist/`.
**agency:** `Senior Developer`
**docs:** `docs/ERROR-HANDLING.md`, `docs/CONVENTIONS.md`, existing service patterns in the same file

- [ ] **Step 1: Add the import**

In the imports block at top of `src/modules/job-application/job-application.service.ts`:

```typescript
import type { ITrackTailoringApplication } from './interfaces/track-tailoring-application.interface';
```

If `ApplicationSource` is not already imported from the entity, add it alongside `ApplicationStatus`:

```typescript
import {
  JobApplication,
  ApplicationStatus,
  ApplicationSource,
} from '../../database/entities/job-application.entity';
```

- [ ] **Step 2: Add the method**

Insert after the existing `getUserTags` method (around line 480 in the current file), before the private helpers section:

```typescript
  /**
   * Auto-track a job application after a successful resume tailoring.
   *
   * Single source of truth for "generated resume becomes tracked application".
   * Idempotent via the partial unique index
   * `uq_job_applications_resume_generation_id` — duplicate-key violations are
   * swallowed so the same tailoring (retried batch job, double-fire from
   * orchestrator) never produces multiple rows.
   *
   * Returns the persisted row on first call, `null` when the unique index
   * rejected the insert (already tracked).
   */
  async trackTailoringApplication(
    input: ITrackTailoringApplication,
  ): Promise<JobApplication | null> {
    this.logger.log(
      `Tracking tailoring application for user ${input.userId}, resume_generation ${input.resumeGenerationId}`,
    );

    try {
      return await this.createJobApplication({
        user_id: input.userId,
        company_name: input.companyName,
        job_position: input.jobPosition,
        job_description: input.jobDescription,
        application_source: ApplicationSource.TAILORED_RESUME,
        status: ApplicationStatus.APPLIED,
        resume_generation_id: input.resumeGenerationId,
        applied_at: new Date().toISOString(),
      });
    } catch (error) {
      if (this.isUniqueResumeGenerationConflict(error)) {
        this.logger.log(
          `Tailoring application already tracked for resume_generation ${input.resumeGenerationId} — skipping`,
        );
        return null;
      }
      throw error;
    }
  }

  private isUniqueResumeGenerationConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const driverError = (error as { driverError?: unknown }).driverError;
    const candidate = (driverError ?? error) as {
      code?: string;
      constraint?: string;
    };
    return (
      candidate.code === '23505' &&
      candidate.constraint === 'uq_job_applications_resume_generation_id'
    );
  }
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exit code 0; no TS errors.

---

## Task 4: Export `JobApplicationService` for cross-module DI

**path:** `src/modules/job-application/job-application.module.ts`
**intent:** Allow `ResumeTailoringModule` and `BatchTailoringV2Module` to inject the service.
**verify:** `npm run build` succeeds.
**agency:** `Backend Architect`
**docs:** `docs/ARCHITECTURE.md` (module boundaries)

- [ ] **Step 1: Read the current module file**

```bash
sed -n '1,60p' src/modules/job-application/job-application.module.ts
```

- [ ] **Step 2: Ensure `exports: [JobApplicationService]` is present**

If absent, modify the `@Module({...})` decorator to include it (keep all existing entries untouched):

```typescript
@Module({
  imports: [
    TypeOrmModule.forFeature([JobApplication, ResumeGeneration, User]),
    SharedModule,
  ],
  controllers: [JobApplicationController, JobApplicationInterviewController],
  providers: [JobApplicationService, JobApplicationInterviewService],
  exports: [JobApplicationService],
})
export class JobApplicationModule {}
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exit code 0.

---

## Task 5: Wire batch processor to auto-track

**path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.processor.ts`, `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.module.ts`
**intent:** Inject `JobApplicationService`; after `jobRepo.update({state:'completed'})`, call `trackTailoringApplication`. Failures are logged but never fail the user-facing job (resume already delivered).
**verify:** `npm run build` succeeds. Manual smoke test in Task 12 will validate runtime behavior.
**agency:** `Backend Architect`
**docs:** `docs/ERROR-HANDLING.md`, existing `recordUsage` pattern at `batch-tailoring-v2.processor.ts:133-143`

- [ ] **Step 1: Update the module — add `JobApplicationModule` to imports**

In `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.module.ts`:

```typescript
import { JobApplicationModule } from '../../job-application/job-application.module';

@Module({
  imports: [
    // ...existing imports
    JobApplicationModule,
  ],
  // ...
})
export class BatchTailoringV2Module {}
```

- [ ] **Step 2: Inject `JobApplicationService` in the processor constructor**

In `batch-tailoring-v2.processor.ts`:

```typescript
import { JobApplicationService } from '../../job-application/job-application.service';
// ...

constructor(
  @InjectRepository(BatchTailoringJob)
  private readonly jobRepo: Repository<BatchTailoringJob>,
  @InjectRepository(BatchTailoringRun)
  private readonly runRepo: Repository<BatchTailoringRun>,
  private readonly orchestrator: ResumeGenerationOrchestratorService,
  private readonly events: BatchTailoringV2EventsGateway,
  private readonly rateLimitService: RateLimitService,
  private readonly errorClassifier: BatchJobErrorClassifierService,
  private readonly jobApplications: JobApplicationService,
) {}
```

- [ ] **Step 3: Call the tracker after `state='completed'` persist and before SSE emit**

Locate the existing block (`batch-tailoring-v2.processor.ts:118-143`). After the `recordUsage` try/catch (the block ending around line 143), insert:

```typescript
      // Auto-track this generation as a job_application — single source of
      // truth for "tailored resume becomes a tracked application". The DB
      // partial unique index guarantees idempotency across worker retries.
      // Failures are logged but never fail the batch job; the user has
      // already received their resume.
      try {
        await this.jobApplications.trackTailoringApplication({
          userId: job.data.userId,
          resumeGenerationId: result.resumeGenerationId,
          companyName: job.data.companyName,
          jobPosition: job.data.jobPosition,
          jobDescription: job.data.jobDescription,
        });
      } catch (trackError) {
        this.logger.error(
          `Failed to auto-track application for batch job ${batchJobId}`,
          trackError instanceof Error ? trackError.stack : trackError,
        );
      }
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: exit code 0.

---

## Task 6: Wire single-tailor orchestrator to auto-track

**path:** `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts`, `src/modules/resume-tailoring/resume-tailoring.module.ts`
**intent:** Inject `JobApplicationService`; call `trackTailoringApplication` right before the pdf-success return; swallow errors.
**verify:** `npm run build` succeeds.
**agency:** `Backend Architect`
**docs:** `docs/ARCHITECTURE.md`, `docs/ERROR-HANDLING.md`

- [ ] **Step 1: Update the module — import `JobApplicationModule`**

In `src/modules/resume-tailoring/resume-tailoring.module.ts`:

```typescript
import { JobApplicationModule } from '../job-application/job-application.module';

@Module({
  imports: [
    // ...existing
    JobApplicationModule,
  ],
  // ...
})
export class ResumeTailoringModule {}
```

- [ ] **Step 2: Inject `JobApplicationService` in `ResumeGenerationOrchestratorService`**

In `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts`:

```typescript
import { JobApplicationService } from '../../job-application/job-application.service';
// ...

constructor(
  // ...all existing injected dependencies — leave them alone
  private readonly jobApplications: JobApplicationService,
) {}
```

- [ ] **Step 3: Call tracker on the pdf-success return**

Locate the existing `return { kind: 'pdf' as const, resumeGenerationId: savedGeneration.id, ... }` near `resume-generation-orchestrator.service.ts:670-680`. Immediately before that `return` statement, insert:

```typescript
    // Auto-track this generation as a job_application. Idempotent — the DB
    // partial unique index on `resume_generation_id` guarantees one row even
    // under retry. Failures are logged but never fail the user-facing pdf
    // delivery; the resume has already been generated and persisted.
    try {
      await this.jobApplications.trackTailoringApplication({
        userId: input.userContext.userId,
        resumeGenerationId: savedGeneration.id,
        companyName: input.companyName,
        jobPosition: input.jobPosition,
        jobDescription: input.jobDescription,
      });
    } catch (trackError) {
      this.logger.error(
        `Failed to auto-track application for resume_generation ${savedGeneration.id}`,
        trackError instanceof Error ? trackError.stack : trackError,
      );
    }
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: exit code 0.

---

## Task 7: Emit `jobDescription` in batch SSE + snapshot (defensive)

**path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.processor.ts`, `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts`
**intent:** Server-side result payloads include `jobDescription` so any future consumer or audit tool doesn't have to reconstruct it from the original request payload. Frontend no longer needs it for tracking, but keeping parity prevents the next bug.
**verify:** `npm run build` succeeds. Manual: hit `GET /resume-tailoring/batch/:batchId/status` for a completed batch and confirm each completed job's `result.jobDescription` matches what the user submitted.
**agency:** `Backend Architect`
**docs:** `docs/API-PATTERNS.md` (SSE event shapes)

- [ ] **Step 1: Update `batch-tailoring-v2.processor.ts` — JOB_COMPLETED SSE payload**

Find the `BATCH_V2_SSE_EVENT_NAMES.JOB_COMPLETED` emit (around line 151). Add `jobDescription: job.data.jobDescription,` inside the `result` object:

```typescript
        result: {
          jobPosition: job.data.jobPosition,
          companyName: job.data.companyName,
          jobDescription: job.data.jobDescription,
          status: 'success',
          resumeGenerationId: result.resumeGenerationId,
          filename: result.filename,
          optimizationConfidence: result.optimizationConfidence,
          keywordsAdded: result.keywordsAdded,
          sectionsChanged: result.sectionsChanged,
          matchScore: result.matchScore,
          matchScoreBefore: result.matchScoreBefore,
          matchScoreAfter: result.matchScoreAfter,
        },
```

- [ ] **Step 2: Update `batch-tailoring-v2.service.ts` `toResult`**

Locate `toResult` (around line 556). Add `jobDescription: job.job_description,` to the returned object:

```typescript
    return {
      jobPosition: job.job_position,
      companyName: job.company_name,
      jobDescription: job.job_description,
      status: 'success',
      resumeGenerationId: rg?.id,
      filename: generateResumeFilename(candidateName, job.job_position),
      keywordsAdded: rg?.keywords_added ?? 0,
      sectionsChanged: this.extractSectionsChanged(rg ?? null),
      matchScore,
      matchScoreBefore: rg?.matchScoreBefore ?? undefined,
      matchScoreAfter: rg?.matchScoreAfter ?? undefined,
    };
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exit code 0.

---

## Task 8: Structured error logging — single-tailor flow

**path:** `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts`, `src/modules/resume-tailoring/resume-tailoring.controller.ts`
**intent:** Every failure mode in the single-tailor pipeline emits a structured log line carrying `userId`, `jobPosition`, `companyName`, `templateId`, `resumeId`, `hasResumeFile`, `stage`, `errorName`, `errorMessage`, and the raw stack. Critical non-fatal side-effects (relevance persistence) are guarded so a side-channel failure does not abort the user-facing pdf delivery. Pipeline stages are wrapped with stage-tagged try/catch so the log unambiguously names which stage broke.
**verify:** `npm run build` succeeds. Manual: temporarily throw inside `runOptimization` → log line contains `"stage":"optimization"` and every required key. Revert the throw before continuing.
**agency:** `Backend Architect`
**docs:** `docs/ERROR-HANDLING.md`, `docs/CONVENTIONS.md`

- [ ] **Step 1: Add a structured-log helper in the orchestrator**

In `resume-generation-orchestrator.service.ts`, just below the `logger` field declaration (around line 57), add:

```typescript
  /**
   * Emit a single JSON-serializable error line for a pipeline stage. Keys are
   * fixed so log searches (Railway / Grafana / Loki) can grep on any of them.
   * The raw stack is passed as the second argument so default NestJS console
   * formatting still prints it; structured-log transports pick up the keys
   * from the first argument.
   */
  private logStageError(
    stage: string,
    input: ResumeGenerationInput,
    error: unknown,
    extra: Record<string, unknown> = {},
  ): void {
    const payload = {
      event: 'resume_generation.stage_failed',
      stage,
      userId: input.userContext?.userId ?? null,
      jobPosition: input.jobPosition,
      companyName: input.companyName,
      templateId: input.templateId,
      resumeId: input.resumeId ?? null,
      hasResumeFile: !!input.resumeFile,
      errorName: error instanceof Error ? error.name : 'Unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
      ...extra,
    };
    this.logger.error(
      JSON.stringify(payload),
      error instanceof Error ? error.stack : undefined,
    );
  }

  /**
   * Run a pipeline stage and structurally log + rethrow if it fails. AbortError
   * is intentionally NOT logged — it's a normal control flow signal when the
   * relevance check shortcuts the tailor pipeline.
   */
  private async withStage<T>(
    stage: string,
    input: ResumeGenerationInput,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      this.logStageError(stage, input, error);
      throw error;
    }
  }
```

- [ ] **Step 2: Wrap every stage call in `runTailoringPipeline`**

Replace the body of `runTailoringPipeline` (currently around lines 251-337) so each stage helper is invoked through `withStage`:

```typescript
  private async runTailoringPipeline(
    input: ResumeGenerationInput,
    signal: AbortSignal,
  ): Promise<ResumeGenerationResult> {
    const startTime = Date.now();

    if (!input.resumeFile) {
      await this.withStage('profile-readiness', input, () =>
        this.assertProfileReady(input.userContext.userId),
      );
    }
    this.throwIfAborted(signal, 'pre-validation');

    const validationTime = await this.withStage('validation', input, () =>
      this.runValidation(input),
    );
    this.throwIfAborted(signal, 'post-validation');

    const { jobAnalysis, resumeContent, parallelOperationsTime } =
      await this.withStage('analysis-and-processing', input, () =>
        this.runAnalysisAndProcessing(input),
      );
    this.throwIfAborted(signal, 'post-analysis');

    const { optimizationResult, optimizationTime } = await this.withStage(
      'optimization',
      input,
      () => this.runOptimization(input, jobAnalysis, resumeContent),
    );
    this.throwIfAborted(signal, 'post-optimization');

    const scores = this.computeScores(
      jobAnalysis,
      resumeContent,
      optimizationResult,
    );
    this.throwIfAborted(signal, 'pre-pdf');

    const { pdfResult, pdfGenerationTime } = await this.withStage(
      'pdf-generation',
      input,
      () => this.runPdfGeneration(input, optimizationResult),
    );
    this.throwIfAborted(signal, 'post-pdf');

    const diff = this.changesDiffComputationService.computeDiff(
      resumeContent.content as unknown as TailoredContent,
      optimizationResult.optimizedContent,
      {
        mandatorySkills: jobAnalysis.technical.mandatorySkills,
        primaryKeywords: jobAnalysis.keywords.primary,
      },
      {
        originalText: resumeContent.originalText,
        jobAnalysis,
      },
    );

    const { savedGeneration, dbTime } = await this.withStage(
      'persist-generation',
      input,
      () =>
        this.persistGeneration(
          input,
          resumeContent,
          optimizationResult,
          pdfResult,
          jobAnalysis,
          scores,
          diff,
        ),
    );

    const totalProcessingTime = Date.now() - startTime;
    this.logger.log(
      `Resume generation completed in ${totalProcessingTime}ms ` +
        `(Validation: ${validationTime}ms, Parallel: ${parallelOperationsTime}ms, ` +
        `Optimization: ${optimizationTime}ms, PDF: ${pdfGenerationTime}ms, DB: ${dbTime}ms, Diff: inline)`,
    );

    return this.buildResult(
      input,
      pdfResult,
      savedGeneration,
      resumeContent,
      optimizationResult,
      jobAnalysis,
      scores,
      diff,
      {
        validationTime,
        parallelOperationsTime,
        optimizationTime,
        pdfGenerationTime,
        dbTime,
        totalProcessingTime,
      },
    );
  }
```

- [ ] **Step 3: Tag relevance + tailor races independently in `generateOptimizedResume`**

Replace the body of `generateOptimizedResume` (currently around lines 84-157) so the two parallel branches log distinct stages before rejection bubbles up:

```typescript
  async generateOptimizedResume(
    input: ResumeGenerationInput,
  ): Promise<ResumeGenerationResult> {
    this.logger.log(
      `Starting resume generation for ${input.jobPosition} at ${input.companyName}`,
    );

    const abortController = new AbortController();

    const relevancePromise = this.resolveRelevanceProfile(input)
      .then((profile) =>
        this.jobRelevanceService.score({
          userId: input.userContext?.userId ?? null,
          profile,
          jobPosition: input.jobPosition,
          companyName: input.companyName,
          jobDescription: input.jobDescription,
          abortSignal: abortController.signal,
        }),
      )
      .catch((err: unknown) => {
        this.logStageError('relevance-scoring', input, err);
        throw err;
      });

    const tailorPromise = this.runTailoringPipeline(
      input,
      abortController.signal,
    ).catch((err: Error): ResumeGenerationResult | null => {
      if (err.name === 'AbortError') return null;
      throw err;
    });

    const relevance = await relevancePromise;

    const isLowFit =
      relevance.verdict === JobRelevanceVerdict.LOW && !input.acknowledgeLowFit;

    if (isLowFit) {
      abortController.abort();
      await tailorPromise;
      this.logger.log(
        `[JobRelevance] Aborted tailor — score=${relevance.score} verdict=${relevance.verdict} ack=false`,
      );
      return { kind: 'low_fit_warning', relevance };
    }

    const tailorOutcome = await tailorPromise;

    if (!tailorOutcome) {
      throw new InternalServerErrorException(
        'Tailor pipeline produced no result after relevance check passed',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    if (tailorOutcome.kind !== 'pdf') {
      throw new InternalServerErrorException(
        'Unexpected non-pdf result from tailor pipeline',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    if (tailorOutcome.resumeGenerationId) {
      try {
        await this.resumeGenerationRepository.update(
          { id: tailorOutcome.resumeGenerationId },
          {
            preGenerationRelevance: {
              ...relevance,
              acknowledgedLowFit: !!input.acknowledgeLowFit,
            },
          },
        );
      } catch (relevancePersistError) {
        // Side-channel write — do NOT fail the user-facing pdf delivery if
        // this update blips. The pdf has already been generated and the
        // resume_generation row already exists; the relevance JSONB column
        // is purely analytical context.
        this.logStageError('persist-relevance', input, relevancePersistError, {
          resumeGenerationId: tailorOutcome.resumeGenerationId,
        });
      }
    }

    return { ...tailorOutcome, relevance };
  }
```

- [ ] **Step 4: Replace `saveResumeGenerationRecord` log block with the structured helper**

Replace the existing `catch (error) { ... }` inside `saveResumeGenerationRecord` (around lines 734-750) with:

```typescript
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          event: 'resume_generation.persist_failed',
          userId: payload.user_id ?? null,
          templateId: payload.template_id ?? null,
          companyName: payload.company_name ?? null,
          jobPosition: payload.job_position ?? null,
          errorName: error instanceof Error ? error.name : 'Unknown',
          errorMessage:
            error instanceof Error ? error.message : 'Unknown database error',
        }),
        error instanceof Error ? error.stack : undefined,
      );
      throw new InternalServerErrorException(
        'Failed to save resume generation record. Please try again or contact support if the issue persists.',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
```

- [ ] **Step 5: Enrich the controller catch**

In `resume-tailoring.controller.ts`, replace the catch block of `generateTailoredResume` (around lines 278-296) with:

```typescript
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        JSON.stringify({
          event: 'resume_generation.request_failed',
          userId: request.userContext?.userId ?? null,
          jobPosition: generateResumeDto.jobPosition,
          companyName: generateResumeDto.companyName,
          templateId: generateResumeDto.templateId,
          resumeId: generateResumeDto.resumeId ?? null,
          hasResumeFile: !!resumeFile,
          processingTimeMs: processingTime,
          errorName: error instanceof Error ? error.name : 'Unknown',
          errorMessage:
            error instanceof Error ? error.message : String(error),
        }),
        error instanceof Error ? error.stack : undefined,
      );

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw error;
    }
```

- [ ] **Step 6: Build**

```bash
npm run build
```

Expected: exit code 0.

---

## Task 9: Structured error logging — batch-tailor flow

**path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.processor.ts`
**intent:** Every state transition, SSE emit, run-counter bump, and finalization in the batch processor is guarded with structured logging that carries `batchId`, `batchJobId`, `jobIndex`, `userId`, `companyName`, `jobPosition`, `stage`, and error metadata. Non-fatal side-effects (SSE publish) never abort the worker; the secondary failure-state write is guarded so a DB blip while recording a primary failure still produces a log line about both.
**verify:** `npm run build` succeeds. Manual: temporarily make `events.publish` throw → backend log shows `event="batch_v2.sse_publish_failed"` and the worker still finishes the job.
**agency:** `Backend Architect`
**docs:** `docs/ERROR-HANDLING.md`, existing pattern at `batch-tailoring-v2.processor.ts:133-143`

- [ ] **Step 1: Add a structured-log helper inside the processor**

In `batch-tailoring-v2.processor.ts`, just below the `private readonly logger` field, add:

```typescript
  /**
   * Build the canonical structured-log payload for a batch-job event so every
   * log line in this processor shares the same key set. Pass the job's
   * `data` payload so `userId`, `companyName`, `jobPosition` are always
   * present.
   */
  private buildLogContext(
    data: BatchJobPayloadV2,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      userId: data.userId,
      batchId: data.batchId,
      batchJobId: data.batchJobId,
      jobIndex: data.jobIndex,
      companyName: data.companyName,
      jobPosition: data.jobPosition,
      ...extra,
    };
  }

  private logProcessorError(
    event: string,
    data: BatchJobPayloadV2,
    error: unknown,
    extra: Record<string, unknown> = {},
  ): void {
    this.logger.error(
      JSON.stringify({
        event,
        ...this.buildLogContext(data, extra),
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage:
          error instanceof Error ? error.message : String(error),
      }),
      error instanceof Error ? error.stack : undefined,
    );
  }
```

- [ ] **Step 2: Guard `transition` calls in `handle`**

Replace the three `await this.transition(...)` invocations inside `handle` (currently lines 69, 88, 109) so each is wrapped:

```typescript
      // Stage 1: analyzing
      try {
        await this.transition(batchJobId, 'analyzing');
      } catch (transitionError) {
        this.logProcessorError(
          'batch_v2.transition_failed',
          job.data,
          transitionError,
          { fromStage: 'queued', toStage: 'analyzing' },
        );
        throw transitionError;
      }

      try {
        await this.runRepo.update(
          { id: batchId, status: 'queued' },
          { status: 'processing' },
        );
      } catch (runUpdateError) {
        this.logProcessorError(
          'batch_v2.run_status_update_failed',
          job.data,
          runUpdateError,
          { intendedStatus: 'processing' },
        );
        throw runUpdateError;
      }

      await this.safeEmit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_STARTED, {
        batchId,
        jobId: batchJobId,
        jobIndex,
        stage: 'analyzing',
      }, job.data);

      // Stage 2: optimizing
      try {
        await this.transition(batchJobId, 'optimizing');
      } catch (transitionError) {
        this.logProcessorError(
          'batch_v2.transition_failed',
          job.data,
          transitionError,
          { fromStage: 'analyzing', toStage: 'optimizing' },
        );
        throw transitionError;
      }
      await this.safeEmit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_PROGRESS, {
        batchId,
        jobId: batchJobId,
        jobIndex,
        stage: 'optimizing',
      }, job.data);
```

Repeat the same pattern around the `'finalizing'` transition (currently line 109) — wrap in try/catch with `fromStage: 'optimizing', toStage: 'finalizing'`, then call `safeEmit` for `JOB_PROGRESS`.

- [ ] **Step 3: Add `safeEmit` — non-fatal SSE emit wrapper**

Add this method below `emit` (around line 319):

```typescript
  /**
   * Emit an SSE event without ever failing the worker. SSE delivery is
   * advisory — the snapshot endpoint is the source of truth for replay — so a
   * transient publish/event-id-update failure must not poison the batch.
   */
  private async safeEmit(
    batchId: string,
    eventName: string,
    data: Record<string, unknown>,
    jobData: BatchJobPayloadV2,
  ): Promise<void> {
    try {
      await this.emit(batchId, eventName, data);
    } catch (emitError) {
      this.logProcessorError(
        'batch_v2.sse_publish_failed',
        jobData,
        emitError,
        { sseEvent: eventName },
      );
    }
  }
```

Then replace **every remaining** `await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.X, { ... })` inside `handle` with the corresponding `await this.safeEmit(batchId, BATCH_V2_SSE_EVENT_NAMES.X, { ... }, job.data)`. This covers `JOB_COMPLETED` (around line 151) and `JOB_FAILED` (around line 207).

- [ ] **Step 4: Guard the `state='completed'` write + `bumpRunCounters`**

Replace the existing `await this.jobRepo.update(...)` and `await this.bumpRunCounters(...)` block (around lines 118-126) with:

```typescript
      try {
        await this.jobRepo.update(
          { id: batchJobId },
          {
            state: 'completed',
            resume_generation_id: result.resumeGenerationId,
            completed_at: new Date(),
          },
        );
      } catch (persistError) {
        this.logProcessorError(
          'batch_v2.complete_persist_failed',
          job.data,
          persistError,
          { resumeGenerationId: result.resumeGenerationId },
        );
        throw persistError;
      }

      try {
        await this.bumpRunCounters(batchId, { completed: 1 });
      } catch (bumpError) {
        this.logProcessorError(
          'batch_v2.bump_run_counters_failed',
          job.data,
          bumpError,
          { delta: { completed: 1 } },
        );
        throw bumpError;
      }
```

Repeat the `bumpRunCounters` wrap for the failure path around line 205 (delta `{ failed: 1 }`).

- [ ] **Step 5: Guard the failure-state DB write inside the outer catch**

Inside the outer `catch (error) { ... }` block (around lines 177-218), wrap the failure-state persist:

```typescript
      try {
        await this.jobRepo.update(
          { id: batchJobId },
          {
            state: 'failed',
            error_message: envelopeJson,
            completed_at: new Date(),
          },
        );
      } catch (failurePersistError) {
        // Secondary write — original failure already logged below. Log the
        // secondary so we know the row was never marked failed; otherwise
        // the batch will appear stuck in 'optimizing' forever.
        this.logProcessorError(
          'batch_v2.failure_persist_failed',
          job.data,
          failurePersistError,
          { originalCategory: envelope.category },
        );
      }
```

- [ ] **Step 6: Enrich the outer-catch primary log**

Replace the existing `this.logger.error(...)` call inside the outer catch (around lines 189-192) with:

```typescript
      this.logger.error(
        JSON.stringify({
          event: 'batch_v2.job_failed',
          ...this.buildLogContext(job.data, {
            category: envelope.category,
            technicalDetail: envelope.technicalDetail,
            retryCount: job.data.batchJobId ? undefined : undefined,
            durationMs: Date.now() - startedAt,
          }),
          errorName: error instanceof Error ? error.name : 'Unknown',
          errorMessage:
            error instanceof Error ? error.message : String(error),
        }),
        error instanceof Error ? error.stack : undefined,
      );
```

- [ ] **Step 7: Guard `maybeFinishBatch` calls**

In both branches (success path around line 176 and failure path around line 217), wrap:

```typescript
      try {
        await this.maybeFinishBatch(batchId, startedAt);
      } catch (finishError) {
        this.logProcessorError(
          'batch_v2.maybe_finish_failed',
          job.data,
          finishError,
        );
      }
```

`maybeFinishBatch` failure must not throw — the job state is already terminal, and re-throwing would force Bull to retry the whole job, which would duplicate side effects (track + recordUsage).

- [ ] **Step 8: Wrap the new `trackTailoringApplication` call (from Task 5) under the same logging helper**

Replace the try/catch added in Task 5 with the helper-driven version so the log line shape stays consistent:

```typescript
      try {
        await this.jobApplications.trackTailoringApplication({
          userId: job.data.userId,
          resumeGenerationId: result.resumeGenerationId,
          companyName: job.data.companyName,
          jobPosition: job.data.jobPosition,
          jobDescription: job.data.jobDescription,
        });
      } catch (trackError) {
        this.logProcessorError(
          'batch_v2.auto_track_failed',
          job.data,
          trackError,
          { resumeGenerationId: result.resumeGenerationId },
        );
      }
```

- [ ] **Step 9: Build**

```bash
npm run build
```

Expected: exit code 0.

---

## Task 10: Backfill migration for historical missed rows

**path:** `src/database/migrations/1815100100000-BackfillMissingTrackedApplications.ts`
**intent:** Insert `job_applications` rows for every `resume_generations` row that has no corresponding tracked application, so users like `7ebb4dd5-051d-42ac-a4e5-9bb8e30a60de` see their full history.
**verify:** Migration runs locally; after it, the orphan query returns 0 and the affected test user shows 3 rows.
**agency:** `Database Optimizer`
**docs:** `docs/CONVENTIONS.md` (migrations), `docs/SECURITY.md` (data backfills)

- [ ] **Step 1: Create the migration file**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill `job_applications` rows for every prior `resume_generations`
 * that never produced a tracked application (FE-tracking dismiss-path bug
 * pre-dating the move to BE-owned tracking).
 *
 * Uses `ON CONFLICT DO NOTHING` against the partial unique index added in
 * AddUniqueResumeGenerationOnJobApplications1815100000000 so the backfill
 * is safe to re-run.
 *
 * `userId` (camelCase, FK) is preferred when present because the legacy
 * `user_id` column is `varchar`; `COALESCE` keeps either source viable.
 */
export class BackfillMissingTrackedApplications1815100100000
  implements MigrationInterface
{
  name = 'BackfillMissingTrackedApplications1815100100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO job_applications (
        user_id,
        resume_generation_id,
        company_name,
        job_position,
        job_description,
        application_source,
        status,
        applied_at,
        created_at,
        updated_at,
        status_history
      )
      SELECT
        COALESCE(rg."userId"::text, rg.user_id),
        rg.id,
        COALESCE(NULLIF(TRIM(rg.company_name), ''), 'Unknown Company'),
        COALESCE(NULLIF(TRIM(rg.job_position), ''), 'Unknown Position'),
        rg.job_description,
        'tailored_resume',
        'applied',
        rg.created_at,
        rg.created_at,
        rg.created_at,
        jsonb_build_array(jsonb_build_object(
          'from', NULL,
          'to', 'applied',
          'changed_at', to_char(rg.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'changed_by_user_id', COALESCE(rg."userId"::text, rg.user_id)
        ))
      FROM resume_generations rg
      WHERE COALESCE(rg."userId"::text, rg.user_id) IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM job_applications ja
          WHERE ja.resume_generation_id = rg.id
        )
      ON CONFLICT ON CONSTRAINT uq_job_applications_resume_generation_id
      DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Intentional no-op. We cannot reliably distinguish backfilled rows
    // from user-edited ones at down-migration time; safer to leave history
    // intact than to risk deleting real user data.
  }
}
```

- [ ] **Step 2: Run locally**

```bash
npm run migration:run
```

Expected: migration logs success.

- [ ] **Step 3: Verify no orphaned generations remain**

```bash
psql "$LOCAL_DATABASE_URL" -c "
SELECT COUNT(*) AS orphans
FROM resume_generations rg
WHERE COALESCE(rg.\"userId\"::text, rg.user_id) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM job_applications ja WHERE ja.resume_generation_id = rg.id)
"
```

Expected: `orphans = 0`.

- [ ] **Step 4: Verify the affected user got their rows back (against staging/prod DB copy)**

```bash
psql "$LOCAL_DATABASE_URL" -c "
SELECT company_name, job_position, resume_generation_id
FROM job_applications
WHERE user_id = '7ebb4dd5-051d-42ac-a4e5-9bb8e30a60de'
ORDER BY created_at DESC
"
```

Expected: 3 rows — Kake (single), Kake (bulk), InnovationTeam (bulk).

---

## Task 11: Frontend — delete batch auto-track POSTs

**path:** `ats-fit-frontend/src/app/features/tailor-apply/batch-tailoring-modal.component.ts`
**intent:** Backend now owns creation; remove `fireBatchTrackingInBackground`, the `JobService` injection, the imports it dragged in, and simplify `close()` so it only emits the dialog result.
**verify:** `npm run build` succeeds in the frontend repo; `npm run lint` clean.
**agency:** `Frontend Developer`
**docs:** `docs/CONVENTIONS.md` (FE conventions), this plan's File Map

- [ ] **Step 1: Edit `batch-tailoring-modal.component.ts`**

Remove the following lines/blocks:
- The `JobService` import.
- The `private readonly jobService = inject(JobService);` line.
- The `fireBatchTrackingInBackground` method (currently around lines 275-302).
- The `JobApplicationCreatePayload` import.
- The `trackedApplicationAppliedAtIso` import (if unused elsewhere in this file).

Replace the existing `close()` method (around line 304) with the simplified version:

```typescript
  /**
   * Close the modal and signal the dashboard to refresh. The backend already
   * created `job_applications` rows for every successful row in this batch
   * (see BatchTailoringV2Processor — auto-track on completion), so the
   * modal does not need to fire any tracking POSTs on close.
   */
  close(): void {
    const summary = this.batchResponse()?.summary;
    const shouldRefresh =
      this.step() === 'results' &&
      summary !== undefined &&
      summary.succeeded > 0;
    const result: TailoringModalCloseResult | undefined = shouldRefresh
      ? { refreshDashboard: true, tailoringCompleted: true }
      : undefined;
    this.dialogRef.close(result);
  }
```

Keep `onFinishWithTracking()` but reduce it to a thin close — its only job now is to close after the "Track All" button confirms (rows already exist server-side):

```typescript
  onFinishWithTracking(): void {
    this.appsTracked = true;
    this.close();
  }
```

If `appsTracked` is no longer read anywhere after these edits, delete it as well.

- [ ] **Step 2: Build & lint**

```bash
cd ../ats-fit-frontend
npm run build
npm run lint
```

Expected: build succeeds; lint clean.

---

## Task 12: Frontend — delete single auto-track POST

**path:** `ats-fit-frontend/src/app/features/tailor-apply/tailor-apply-modal.component.ts`
**intent:** Remove `fireTrackingInBackground`, `buildTrackingPayload`, and `trackApplicationErrorMessage`; the modal becomes presentational. The dashboard refresh signal is preserved via the dialog result.
**verify:** `npm run build` succeeds; `npm run lint` clean.
**agency:** `Frontend Developer`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Edit `tailor-apply-modal.component.ts`**

Remove:
- `JobApplicationCreatePayload` import.
- `JobService` import and its `inject()` line.
- `trackedApplicationAppliedAtIso` import (if unused elsewhere in this file).
- `buildTrackingPayload`, `fireTrackingInBackground`, `trackApplicationErrorMessage` methods.
- The `appTracked` private field (and any reads of it).

Replace `closeModal()` with:

```typescript
  closeModal(): void {
    const hasTailored = this.currentStep() === 4 && this.tailoredResume() !== null;
    const result: TailoringModalCloseResult | undefined = hasTailored
      ? { refreshDashboard: true, tailoringCompleted: true }
      : undefined;
    this.dialogRef.close(result);
  }
```

If the template has a "Done" button whose handler called `jobService.applyNewJobs(...)`, repoint it to `closeModal()`.

- [ ] **Step 2: Build & lint**

```bash
npm run build
npm run lint
```

Expected: build succeeds; lint clean.

---

## Task 13: Frontend — convert "Track All" button to "Tracked" badge

**path:** `ats-fit-frontend/src/app/features/tailor-apply/components/batch-results/batch-results.component.ts`, `.html`
**intent:** Backend already tracked every succeeded row; the explicit button becomes a passive "Tracked in Applications" badge. Clicking the new "Done" button just closes the modal.
**verify:** `npm run build` succeeds; `npm run lint` clean. Manual smoke (Task 12) confirms the badge renders.
**agency:** `Frontend Developer`
**docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Edit `batch-results.component.ts`**

Remove:
- `JobService` and `JobApplicationCreatePayload` imports.
- `private readonly jobService = inject(JobService);` and the related `snackbar` calls inside `trackAllApplications` (the snackbar service can stay if used elsewhere).
- The `isTracking` and `tracked` signals (no longer needed).
- The `trackAllApplications` method.
- The `trackedApplicationAppliedAtIso` import (if unused after the above deletions).

Add the replacement `finish` method:

```typescript
  /** Close the modal — backend already tracked every succeeded row. */
  finish(): void {
    this.finishWithTracking.emit();
  }
```

Keep the `finishWithTracking` output as-is — modal still listens to it.

- [ ] **Step 2: Edit `batch-results.component.html`**

Find the existing "Track All" button (the one whose `(click)` was `trackAllApplications()`). Replace its block with:

```html
<div class="flex items-center gap-2">
  <div class="flex items-center gap-2 text-sm text-emerald-700">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
    <span>Tracked in Applications</span>
  </div>

  <button type="button" (click)="finish()"
          class="ml-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
    Done
  </button>
</div>
```

- [ ] **Step 3: Build & lint**

```bash
npm run build
npm run lint
```

Expected: build succeeds; lint clean.

---

## Task 14: End-to-end manual verification

**path:** `(repo root)` + `ats-fit-frontend`
**intent:** Confirm both flows end-to-end against a running local stack: row count matches succeeded generations regardless of dismiss method.
**verify:** All four DB-count assertions below match the stated expectations.
**agency:** `Evidence Collector`
**docs:** `docs/TESTING-STRATEGY.md` (manual verification section)

- [ ] **Step 1: Start both stacks**

```bash
# Backend (from ats-fit-backend)
npm run start:dev &

# Frontend (from ats-fit-frontend)
cd ../ats-fit-frontend && npm start &
```

Wait for both to be reachable (`curl localhost:3000/api/v1/health` → 200; frontend on `localhost:4200`).

- [ ] **Step 2: Baseline the DB row count for the test user**

```bash
psql "$LOCAL_DATABASE_URL" -c "
SELECT COUNT(*) AS baseline
FROM job_applications
WHERE user_id = '<test-user-uuid>'
"
```

Record this number.

- [ ] **Step 3: Single-tailor flow + ESC dismiss**

In the browser:
1. Sign in as the test user.
2. Open the single tailor-apply modal.
3. Fill the form, generate the resume.
4. After the pdf is delivered, press **ESC** to dismiss.

Assert delta = 1:

```bash
psql "$LOCAL_DATABASE_URL" -c "
SELECT COUNT(*) FROM job_applications
WHERE user_id = '<test-user-uuid>'
  AND created_at > NOW() - INTERVAL '5 minutes'
"
```

Expected: previous baseline + 1.

- [ ] **Step 4: Batch flow + ESC dismiss**

1. Open "Quick Tailor" (batch).
2. Submit two job descriptions (each ≥ 20 chars).
3. Wait for `results` step.
4. Press **ESC**.

Assert delta from new baseline = 2 over the last 5 minutes.

- [ ] **Step 5: Batch flow + backdrop click dismiss**

Repeat Step 4 but dismiss by clicking the backdrop. Reset / re-baseline first.

Expected: delta = 2.

- [ ] **Step 6: Batch flow + "Tailor Another Set" then close**

Repeat with "Tailor Another Set" path, then close the modal. Reset / re-baseline first.

Expected: delta = 2.

- [ ] **Step 7: Confirm idempotency under retry**

In a separate terminal, manually invoke the same insert path twice (e.g., by re-running the batch processor for an already-completed job). Verify only one row exists for that `resume_generation_id`:

```bash
psql "$LOCAL_DATABASE_URL" -c "
SELECT COUNT(*) FROM job_applications
WHERE resume_generation_id = '<known-id>'
"
```

Expected: 1.

- [ ] **Step 8: Confirm idempotency under retry from the BE log**

Tail backend logs and look for the "already tracked" log line emitted by `JobApplicationService.trackTailoringApplication` when the unique index rejects the second insert.

Expected: log line present; no error stack trace.

---

## Task 15: Code review pass

**path:** the whole branch
**intent:** Independent review against the diff to catch SOLID drift, error-handling lapses, missed call sites, and stale FE references.
**verify:** Reviewer signs off; all blocker comments resolved on the same branch.
**agency:** `Code Reviewer`
**docs:** `.ai/rules.md`, `docs/CONVENTIONS.md`, `docs/ERROR-HANDLING.md`, `docs/SECURITY.md`

- [ ] **Step 1: Self-diff sweep**

```bash
git diff master...HEAD --stat
git diff master...HEAD
```

Manually confirm:
- No FE call to `POST /job-applications` remains in the tailor-apply features.
- Both BE call sites (batch processor + single orchestrator) use the same `JobApplicationService.trackTailoringApplication` method (no duplicated logic).
- Migration timestamps are monotonically increasing past `1815000000000`.
- Both BE failure swallow blocks log via `this.logger.error` with the stack.

- [ ] **Step 2: Dispatch the Code Reviewer agent on the diff**

```text
Task(subagent_type="Code Reviewer", prompt="Review feat/be-owned-application-tracking branch against master. Focus on: SRP of the new service method, idempotency correctness under the partial unique index, blast radius of failure swallow in batch processor + orchestrator, completeness of FE deletions (no stale POSTs anywhere), migration safety + reversibility, consistency between single-flow and batch-flow tracker call sites, and quality of new structured error logging — every error path must carry userId / jobPosition / companyName / stage and a stack, with no double-logging or stack loss. Report blockers + nits.")
```

- [ ] **Step 3: Address every blocker**

For each blocker raised, fix it on the same branch. **Still no commits at this stage** — fixes accumulate into the single final commit.

---

## Task 16: Single commit + open PR

**path:** `(repo root)` + GitHub
**intent:** Land the whole change as one atomic commit, push, open the PR for merge review.
**verify:** PR opens, CI is green, description summarizes user-visible impact.
**agency:** `Jira Workflow Steward`
**docs:** `.ai/workflow.md`

- [ ] **Step 1: Stage every changed file**

```bash
git status
git add src/database/migrations/1815100000000-AddUniqueResumeGenerationOnJobApplications.ts \
        src/database/migrations/1815100100000-BackfillMissingTrackedApplications.ts \
        src/modules/job-application/interfaces/track-tailoring-application.interface.ts \
        src/modules/job-application/job-application.service.ts \
        src/modules/job-application/job-application.module.ts \
        src/modules/resume-tailoring/resume-tailoring.module.ts \
        src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts \
        src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.module.ts \
        src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.processor.ts \
        src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts

# Frontend repo
cd ../ats-fit-frontend
git status
git add src/app/features/tailor-apply/batch-tailoring-modal.component.ts \
        src/app/features/tailor-apply/tailor-apply-modal.component.ts \
        src/app/features/tailor-apply/components/batch-results/batch-results.component.ts \
        src/app/features/tailor-apply/components/batch-results/batch-results.component.html
```

Visually scan `git status` — there should be no other modified files (no stray `.tsbuildinfo`, no debug logs).

- [ ] **Step 2: Single commit per repo**

Backend:

```bash
cd ../ats-fit-backend
git commit -m "$(cat <<'EOF'
feat: backend-owned job application tracking for tailored resumes

Moves job-application creation out of the frontend modal-close lifecycle
and into the backend so every successful resume tailoring (single or
batch) deterministically produces a job_applications row.

Eliminates the silent-drop bug where users could dismiss the batch modal
via ESC / backdrop / tab close and lose all tracking for their generated
resumes.

- Add partial unique index on job_applications.resume_generation_id for
  idempotency under retries / double-writes.
- Add JobApplicationService.trackTailoringApplication — single auto-track
  write path consumed by both the single-flow orchestrator and the batch
  processor.
- Backfill historical resume_generations that never produced a tracked
  job_applications row.
- Include jobDescription in batch SSE result and snapshot payloads
  (defensive — FE no longer relies on it for tracking, but keeps server
  payloads complete).
- Structured error logging across both flows. Every failure path now
  emits a single JSON line keyed by userId / jobPosition / companyName /
  stage (single flow) or userId / batchId / batchJobId / jobIndex /
  stage (batch flow), plus errorName + errorMessage and the raw stack.
  Critical non-fatal side-effects (relevance persistence, SSE publish,
  maybeFinishBatch, batch failure-state persist) are guarded so a
  side-channel blip never aborts the worker or masks the original error.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

Frontend:

```bash
cd ../ats-fit-frontend
git commit -m "$(cat <<'EOF'
refactor(tailor-apply): remove frontend auto-track POSTs

Backend now owns job-application creation for both single and batch
tailoring flows (see backend feat: backend-owned job application
tracking). Remove the frontend fire-and-forget POST paths that were
silently dropping tracking when the user dismissed the modal via ESC,
backdrop click, or browser navigation. Replace the explicit "Track All"
button with a passive "Tracked in Applications" badge.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Push both branches**

```bash
cd ../ats-fit-backend
git push -u origin feat/be-owned-application-tracking

cd ../ats-fit-frontend
git push -u origin feat/be-owned-application-tracking
```

- [ ] **Step 4: Open PRs**

```bash
cd ../ats-fit-backend
gh pr create --title "feat: backend-owned job application tracking for tailored resumes" --body "$(cat <<'EOF'
## Summary
- Backend now creates a `job_applications` row whenever a single or batch resume tailoring completes successfully — eliminates the FE-modal-close-path bug that silently dropped tracked applications when users dismissed via ESC / backdrop / tab close.
- Adds partial unique index `uq_job_applications_resume_generation_id` so retries / double-writes are idempotent.
- Backfills historical resume generations that never produced a tracked row.
- Companion FE PR removes the now-redundant auto-track POSTs and replaces "Track All" with a passive "Tracked" badge.

## Test plan
- [ ] Backend `npm run build` clean
- [ ] Migration applies cleanly: `npm run migration:run`
- [ ] Manual: single tailor + ESC dismiss → 1 new `job_applications` row
- [ ] Manual: 2-job batch + ESC dismiss → 2 new rows
- [ ] Manual: 2-job batch + backdrop dismiss → 2 new rows
- [ ] Manual: 2-job batch + "Tailor Another Set" + close → 2 new rows
- [ ] Backfill: `SELECT COUNT(*) FROM resume_generations rg WHERE NOT EXISTS (SELECT 1 FROM job_applications ja WHERE ja.resume_generation_id = rg.id) AND COALESCE(rg."userId"::text, rg.user_id) IS NOT NULL` returns 0
- [ ] Idempotency: re-running the processor for an already-completed job does NOT create a duplicate
EOF
)"
```

Open the frontend PR similarly, linking back to the backend PR URL in the description.

---

## Self-Review Checklist

- [x] Every task has `path`, `intent`, `verify`, `agency`, `docs`.
- [x] No `general-purpose` agent.
- [x] No `TBD` / `add appropriate X` placeholders — every code step shows the code.
- [x] No automated test tasks (per user directive).
- [x] No per-task commits — all commits batched into Task 14 (per user directive).
- [x] Single source of truth: `JobApplicationService.trackTailoringApplication` is the only auto-track write path.
- [x] DRY: batch and single share the same method, the same idempotency guarantee, the same error-handling pattern.
- [x] Spec coverage: every original concern (close-path bypass, silent error swallow, missing `jobDescription`, single/batch symmetry, historical backfill, structured error logging across both flows) maps to a numbered task.
- [x] Error-logging coverage: every catch / failure side-effect in single + batch flows emits a structured JSON log line with userId, stage, and the originating error metadata.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-backend-owned-job-application-tracking.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
