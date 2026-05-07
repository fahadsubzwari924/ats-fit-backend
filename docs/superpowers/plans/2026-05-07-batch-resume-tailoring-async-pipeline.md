# Batch Resume Tailoring v2 — Async Queue + SSE Streaming Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Created:** 2026-05-07
**Status:** Ready for implementation
**Repos affected:** `ats-fit-backend` (queue + workers + endpoints) + `ats-fit-frontend` (SSE consumer + progressive UI)

---

## Working agreements (READ FIRST)

These rules override the writing-plans skill defaults for this plan:

1. **NO per-task commits.** Implementer runs verification at the end of each task but does **not** run `git commit`. The user will commit everything at the end after a final review.
2. **v1 stays alive — v2 is built alongside.** Do **not** delete or rename the existing `POST /resume-tailoring/batch-generate` endpoint, the existing `BatchResultsComponent` rendering path, or any v1 service methods. The new pipeline is a **separate v2 surface** under `/resume-tailoring/batch/v2/...`. The frontend switches its actual usage to v2; the v1 surface remains as a working fallback for one release cycle.
3. **Spec docs must stay in sync.** Tasks updating `docs/specs/03-resume-tailoring.md` are part of the plan, not optional. Any new endpoint or behavior must be reflected before the work is considered done.

---

## 1. Goal

Convert batch resume tailoring from a **synchronous request-response** model (1.7 minutes for 2 resumes, scales linearly) into an **async queue + SSE streaming** pipeline (v2) that:

1. Returns API in <500ms with `{ batchId, totalJobs }`
2. Processes all jobs in parallel via Bull workers (max 3 jobs per batch, concurrency 3 → all jobs run in parallel)
3. Streams per-job progress + completion events to the frontend via Server-Sent Events
4. Computes the changes diff **inline** in the worker — single source of truth, eliminating the dual-count UX bug
5. Survives connection drops, tab close, and page refresh via persistent batch state in the database

End-state user experience: API instant, first result visible in ~30s, all 3 results in ~50s (vs. current ~90s blank spinner).

## 2. Non-goals

- **No removal of v1 batch endpoint or its consumers.** v1 remains alive and functional alongside v2.
- **No change to single-resume tailoring flow.** Single-resume keeps its current synchronous pipeline + async `changes_diff` queue.
- **No change to Anthropic prompt caching, optimizer service, or PDF generator.** Worker reuses `ResumeGenerationOrchestratorService` as-is.
- **No WebSockets, no long-polling.** SSE only, with a polling fallback endpoint for proxy/CDN edge cases.
- **No batch size > 3.** Hard-cap at 3 jobs per batch matches the product constraint and keeps Anthropic rate limits irrelevant.
- **No new unit tests.** Per existing project rule. Manual verification per task.
- **No removal of the standalone `changes_diff` queue.** It still serves single-resume tailoring.

## 3. Architecture

```
┌─────────────────────┐                                   ┌─────────────────────────┐
│   Frontend (modal)  │                                   │      Backend (NestJS)   │
└─────────────────────┘                                   └─────────────────────────┘
         │                                                            │
         │ POST /resume-tailoring/batch/v2/generate                   │
         │   body: { jobs[1..3], templateId, resumeId? }              │
         ├───────────────────────────────────────────────────────────►│
         │                                                            │
         │            ┌─────────────────────────────────────┐         │
         │            │ BatchTailoringV2Service.enqueueBatch│         │
         │            │  - Insert batch_tailoring_runs row  │         │
         │            │  - Insert N batch_tailoring_jobs    │         │
         │            │  - Enqueue N Bull jobs (concurrency │         │
         │            │    3) on `batch_tailoring_v2` queue │         │
         │            └─────────────────────────────────────┘         │
         │                                                            │
         │  ◄── 202 { batchId, totalJobs } (~300ms total)             │
         │                                                            │
         │ GET /resume-tailoring/batch/v2/:batchId/events  (EventSource)│
         ├───────────────────────────────────────────────────────────►│
         │                                                            │
         │  ◄══ SSE: snapshot      { totalJobs, jobs[] }              │
         │  ◄══ SSE: job_started   { jobIndex, stage:'analyzing' }    │
         │  ◄══ SSE: job_progress  { jobIndex, stage:'optimizing' }   │
         │  ◄══ SSE: job_completed { jobIndex, result }               │
         │  ◄══ SSE: job_failed    { jobIndex, error }                │
         │  ◄══ SSE: batch_completed { summary }                      │
         │                                                            │
         │                                ┌──────────────────────┐    │
         │                                │ BatchTailoringV2Processor  │
         │                                │  (Bull worker, conc 3)│    │
         │                                │  ┌───────────────────┐│    │
         │                                │  │ analyze→optimize  ││    │
         │                                │  │ →PDF→diff(sync)   ││    │
         │                                │  │ →persist + emit   ││    │
         │                                │  └───────────────────┘│    │
         │                                └──────────────────────┘    │
```

**v1 vs v2 (route map):**

| Surface | v1 (existing, kept) | v2 (new) |
|---|---|---|
| Endpoint | `POST /resume-tailoring/batch-generate` | `POST /resume-tailoring/batch/v2/generate` |
| Response | Synchronous: full results array (~90s for 2 jobs) | Async 202: `{ batchId, totalJobs }` (<500ms) |
| Updates | None until response | SSE on `GET /resume-tailoring/batch/v2/:batchId/events` |
| Polling | n/a | `GET /resume-tailoring/batch/v2/:batchId/status` |
| Diff | Async queue (`changes_diff`) | Synchronous in worker |
| Bull queue | none (sequential in HTTP path) | `batch_tailoring_v2` |
| Frontend usage | None after v2 ships (kept as fallback only) | Default for all batch tailoring |

**Key architectural decisions (frozen):**

| Decision | Choice | Rationale |
|---|---|---|
| Transport | Server-Sent Events (SSE) | One-way server→client streaming, HTTP-friendly, browser auto-reconnect, simpler than WebSocket, lighter than polling |
| Queue library | Existing `@nestjs/bull` | Already in use for `changes_diff` queue — no infra change needed |
| Concurrency | Worker concurrency = 3 (matches max batch size) | All jobs in a single batch run truly in parallel, no Anthropic rate limit risk |
| Diff computation | Inline in worker, synchronous (v2 only) | Single source of truth; v1 path unchanged |
| Batch state persistence | New `batch_tailoring_runs` + `batch_tailoring_jobs` tables | Survives restarts, supports reconnect-after-refresh, indexed query by `batch_id` |
| SSE event source | Bull processor → in-process pub-sub Subject → SSE controller | Clean separation; one Subject keyed by batchId |
| Polling fallback | `GET /resume-tailoring/batch/v2/:batchId/status` | Safety net for proxies/CDNs that strip SSE |
| Reconnect | Browser EventSource auto-reconnect; SSE handler resends snapshot on reconnect | Resume from current state without replaying all events |
| Auth | Existing `JwtAuthGuard` on POST + status endpoints; SSE uses query-string token (EventSource can't set headers) | Works within Angular HttpInterceptor pattern; tenant isolation enforced at service layer |

## 4. SSE Event Contract (frozen)

All events JSON-encoded, one event per `data:` line.

```typescript
event: snapshot
data: {
  batchId: string;
  totalJobs: number;
  status: 'queued' | 'processing' | 'completed' | 'partial' | 'failed';
  jobs: Array<{
    index: number;
    jobPosition: string;
    companyName: string;
    state: 'queued' | 'analyzing' | 'optimizing' | 'finalizing' | 'completed' | 'failed';
    result?: BatchJobResult;     // only when state === 'completed'
    error?: string;              // only when state === 'failed'
  }>;
}

event: job_started
data: { batchId: string; jobIndex: number; stage: 'analyzing' }

event: job_progress
data: { batchId: string; jobIndex: number; stage: 'analyzing' | 'optimizing' | 'finalizing' }

event: job_completed
data: { batchId: string; jobIndex: number; result: BatchJobResult }

event: job_failed
data: { batchId: string; jobIndex: number; error: string }

event: batch_completed
data: {
  batchId: string;
  summary: { total: number; succeeded: number; failed: number; totalProcessingTimeMs: number };
}

event: heartbeat
data: { ts: number }   // every 20s, keeps proxies from killing idle SSE
```

`Last-Event-ID` is a monotonic integer per batch; v1 of v2 (this plan) does not implement event replay — on reconnect, the server re-sends the full `snapshot` event, which is sufficient for our use case.

## 5. Database schema additions

Two new tables. One migration file.

```sql
CREATE TABLE "batch_tailoring_runs" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "user_id" UUID NOT NULL,
  "template_id" UUID,
  "resume_id" UUID,
  "total_jobs" INTEGER NOT NULL,
  "completed_jobs" INTEGER NOT NULL DEFAULT 0,
  "failed_jobs" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
  "last_event_id" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  "completed_at" TIMESTAMP
);
CREATE INDEX "idx_batch_runs_user" ON "batch_tailoring_runs" ("user_id", "created_at" DESC);

CREATE TABLE "batch_tailoring_jobs" (
  "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  "batch_id" UUID NOT NULL REFERENCES "batch_tailoring_runs"("id") ON DELETE CASCADE,
  "job_index" INTEGER NOT NULL,
  "job_position" VARCHAR(255) NOT NULL,
  "company_name" VARCHAR(255) NOT NULL,
  "job_description" TEXT NOT NULL,
  "state" VARCHAR(20) NOT NULL DEFAULT 'queued',
  "resume_generation_id" UUID REFERENCES "resume_generations"("id"),
  "error_message" TEXT,
  "started_at" TIMESTAMP,
  "completed_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "uq_batch_job_index" UNIQUE ("batch_id", "job_index")
);
CREATE INDEX "idx_batch_jobs_batch" ON "batch_tailoring_jobs" ("batch_id", "job_index");
```

## 6. File structure

### Backend — new files

```
src/modules/resume-tailoring/
  batch-tailoring-v2/
    batch-tailoring-v2.module.ts
    batch-tailoring-v2.service.ts
    batch-tailoring-v2.controller.ts
    batch-tailoring-v2.processor.ts
    batch-tailoring-v2.events.gateway.ts
    dto/
      enqueue-batch-v2.dto.ts
      batch-status-v2.dto.ts
    interfaces/
      batch-job-payload.interface.ts
      batch-sse-event.interface.ts
    constants/
      batch-tailoring-v2.constants.ts

src/database/
  entities/
    batch-tailoring-run.entity.ts
    batch-tailoring-job.entity.ts
  migrations/
    1778457600000-AddBatchTailoringTables.ts
```

### Backend — modified files

```
src/modules/resume-tailoring/resume-tailoring.module.ts
  ← register BatchTailoringV2Module

src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts
  ← refactor: compute diff inline, drop shortcut methods (single-resume + v1 batch both benefit)

src/modules/resume-tailoring/services/changes-diff-computation.service.ts
  ← REMOVE computeNewKeywordsCount + computeSectionsChangedCount shortcut methods

docs/specs/03-resume-tailoring.md
  ← add v2 batch generation section, mark v1 as legacy
```

> **Explicitly NOT modified (v1 preservation):**
> - `src/modules/resume-tailoring/resume-tailoring.controller.ts` — v1 batch handler stays
> - `src/modules/resume-tailoring/dtos/batch-generate.dto.ts` — v1 DTO stays (v2 has its own DTO)

### Frontend — new files

```
src/app/features/tailor-apply/components/batch-processing-view/
  batch-processing-view.component.ts
  batch-processing-view.component.html
src/app/features/tailor-apply/components/batch-job-card/
  batch-job-card.component.ts
  batch-job-card.component.html
src/app/features/tailor-apply/services/batch-tailoring-events-v2.service.ts
src/app/features/tailor-apply/services/batch-tailoring-v2.service.ts
src/app/features/tailor-apply/state/batch-tailoring-v2.state.ts
src/app/features/tailor-apply/models/batch-tailoring-v2.model.ts
```

### Frontend — modified files

```
src/app/features/tailor-apply/batch-tailoring-modal.component.ts
  ← swap submission target from v1 service to v2 service; add 'processing' step
src/app/features/tailor-apply/batch-tailoring-modal.component.html
  ← swap generic spinner for <app-batch-processing-view>
docs/specs/03-resume-tailoring.md
  ← shared spec with backend (single file in backend repo, frontend mirrors via reference if needed)
```

> **Explicitly NOT modified (v1 preservation):**
> - `src/app/features/tailor-apply/services/batch-tailoring.service.ts` — v1 service kept
> - `src/app/features/tailor-apply/components/batch-results/batch-results.component.*` — kept; v2 reuses for the final results state

---

## 7. Phase-by-phase tasks

### Phase A — Backend: persistence layer

#### Task A1: Create `batch_tailoring_runs` and `batch_tailoring_jobs` migration

- **path:** `src/database/migrations/1778457600000-AddBatchTailoringTables.ts`
- **intent:** Add the two tables that persist batch + per-job state across requests.
- **verify:** `npm run build && npm run migration:run` exits 0; `\d batch_tailoring_runs` in psql shows both tables with the columns from §5.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`

Steps:

- [ ] **Step 1: Create the migration file** with `up()` and `down()` SQL exactly matching §5. Both tables, both indexes, FK constraint, unique constraint, defaults. Migration class name `AddBatchTailoringTables1778457600000`.

- [ ] **Step 2: Run `npm run migration:generate -- --name=verify` to confirm no schema drift.** Expected: empty migration generated (or near-empty if entities don't exist yet).

- [ ] **Step 3: Run the migration** with `npm run migration:run`. Expected: "Migration AddBatchTailoringTables1778457600000 has been executed successfully".

- [ ] **Step 4: Verify in psql** with `\d batch_tailoring_runs` and `\d batch_tailoring_jobs`. Confirm columns, indexes, FK exist.

#### Task A2: Create TypeORM entity for `BatchTailoringRun`

- **path:** `src/database/entities/batch-tailoring-run.entity.ts`
- **intent:** TypeORM entity matching the `batch_tailoring_runs` table.
- **verify:** `npm run build` passes.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Create the entity file**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BatchTailoringJob } from './batch-tailoring-job.entity';

export type BatchRunStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed';

@Entity({ name: 'batch_tailoring_runs' })
@Index(['user_id', 'created_at'])
export class BatchTailoringRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  template_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  resume_id: string | null;

  @Column({ type: 'int' })
  total_jobs: number;

  @Column({ type: 'int', default: 0 })
  completed_jobs: number;

  @Column({ type: 'int', default: 0 })
  failed_jobs: number;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: BatchRunStatus;

  @Column({ type: 'int', default: 0 })
  last_event_id: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  completed_at: Date | null;

  @OneToMany(() => BatchTailoringJob, (j) => j.batch, { cascade: true })
  jobs: BatchTailoringJob[];
}
```

- [ ] **Step 2: Build.** `npm run build` → 0 errors.

#### Task A3: Create TypeORM entity for `BatchTailoringJob`

- **path:** `src/database/entities/batch-tailoring-job.entity.ts`
- **intent:** TypeORM entity matching the `batch_tailoring_jobs` table.
- **verify:** `npm run build` passes.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Create the entity file**

```typescript
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BatchTailoringRun } from './batch-tailoring-run.entity';
import { ResumeGeneration } from './resume-generations.entity';

export type BatchJobState =
  | 'queued'
  | 'analyzing'
  | 'optimizing'
  | 'finalizing'
  | 'completed'
  | 'failed';

@Entity({ name: 'batch_tailoring_jobs' })
@Index(['batch_id', 'job_index'])
@Unique('uq_batch_job_index', ['batch_id', 'job_index'])
export class BatchTailoringJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  batch_id: string;

  @ManyToOne(() => BatchTailoringRun, (b) => b.jobs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batch_id' })
  batch: BatchTailoringRun;

  @Column({ type: 'int' })
  job_index: number;

  @Column({ type: 'varchar', length: 255 })
  job_position: string;

  @Column({ type: 'varchar', length: 255 })
  company_name: string;

  @Column({ type: 'text' })
  job_description: string;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  state: BatchJobState;

  @Column({ type: 'uuid', nullable: true })
  resume_generation_id: string | null;

  @ManyToOne(() => ResumeGeneration, { nullable: true })
  @JoinColumn({ name: 'resume_generation_id' })
  resume_generation: ResumeGeneration | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'timestamp', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completed_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
```

- [ ] **Step 2: Build.** `npm run build` → 0 errors.

---

### Phase B — Backend: shared orchestrator refactor

#### Task B0: Refactor orchestrator — compute diff inline, remove shortcut methods

- **path:** `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts`, `src/modules/resume-tailoring/services/changes-diff-computation.service.ts`, `src/modules/resume-tailoring/interfaces/resume-generation.interface.ts`
- **intent:** Move full diff computation into the orchestrator's persistence path (synchronous). Persist `changes_diff` directly, eliminating the standalone async diff queue dispatch for **all** callers (single-resume, v1 batch, v2 batch). Then DELETE `computeNewKeywordsCount` and `computeSectionsChangedCount` shortcut methods. Diff is now the single source of truth for `keywordsAdded` and `sectionsChanged`.
- **verify:** Build passes; existing single-resume tailoring still works (manual: hit single endpoint, see same result with `keywordsAdded` and `sectionsChanged` populated, and `changes_diff` jsonb non-null in DB immediately). v1 batch endpoint still works end-to-end.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`, `docs/API-PATTERNS.md`

Steps:

- [ ] **Step 1: In `resume-generation-orchestrator.service.ts`, replace the `dispatchDiffJob` call with synchronous diff computation + persistence.** Find inside `generateOptimizedResume`:

```typescript
this.dispatchDiffJob(
  savedGeneration.id,
  input,
  resumeContent,
  optimizationResult,
  jobAnalysis,
);
```

Replace with:

```typescript
const diff = this.changesDiffComputationService.computeDiff(
  resumeContent.content as unknown as TailoredContent,
  optimizationResult.optimizedContent,
  {
    mandatorySkills: jobAnalysis.technical.mandatorySkills,
    primaryKeywords: jobAnalysis.keywords.primary,
  },
);
await this.resumeGenerationRepository.update(
  { id: savedGeneration.id },
  { changes_diff: diff as unknown as Record<string, unknown> },
);
```

- [ ] **Step 2: Lift diff computation up** before `persistGeneration` and pass it to both `persistGeneration` and `buildResult`. Add `diff` parameter to both. Inside those methods, derive:

```typescript
const keywordsAdded = diff.keywordAnalysis.newlyAdded.length;
const sectionsChanged = diff.sectionsChanged;
```

Use these instead of calls to `computeNewKeywordsCount` and `computeSectionsChangedCount`.

- [ ] **Step 3: Persist `changes_diff`, `keywords_added`, and `sections_changed` (if column exists) inside `persistGeneration`** in a single record save. Eliminate the separate `update` call.

- [ ] **Step 4: Delete `computeNewKeywordsCount` and `computeSectionsChangedCount`** from `changes-diff-computation.service.ts`.

- [ ] **Step 5: Build.** `npm run build` → 0 errors. Fix all callers of the deleted methods.

- [ ] **Step 6: Manual smoke test single-resume endpoint.** Submit one job via the existing single-tailor flow. Verify:
  - HTTP response succeeds
  - `keywordsAdded` and `sectionsChanged` populated correctly
  - `changes_diff` column in `resume_generations` table is non-null **immediately** after response (no async wait)

- [ ] **Step 7: Manual smoke test v1 batch endpoint.** Submit a 2-job batch via the existing `POST /resume-tailoring/batch-generate`. Verify same response shape, all jobs succeed, `changes_diff` populated synchronously.

---

### Phase B (cont.) — Backend: v2 queue + processor

#### Task B1: Define v2 constants and interfaces

- **path:** `src/modules/resume-tailoring/batch-tailoring-v2/constants/batch-tailoring-v2.constants.ts`, `.../interfaces/batch-job-payload.interface.ts`, `.../interfaces/batch-sse-event.interface.ts`
- **intent:** Single source of truth for queue name, event names, max batch size, and the typed payload + SSE event shapes — namespaced as v2 to avoid collision with v1.
- **verify:** `npm run build` passes.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Create `constants/batch-tailoring-v2.constants.ts`**

```typescript
export const BATCH_TAILORING_V2_QUEUE = 'batch_tailoring_v2' as const;
export const BATCH_TAILORING_V2_JOB_NAME = 'process_batch_job' as const;
export const BATCH_V2_MAX_JOBS = 3 as const;
export const BATCH_V2_WORKER_CONCURRENCY = 3 as const;
export const BATCH_V2_HEARTBEAT_MS = 20_000 as const;

export const BATCH_V2_SSE_EVENT_NAMES = {
  SNAPSHOT: 'snapshot',
  JOB_STARTED: 'job_started',
  JOB_PROGRESS: 'job_progress',
  JOB_COMPLETED: 'job_completed',
  JOB_FAILED: 'job_failed',
  BATCH_COMPLETED: 'batch_completed',
  HEARTBEAT: 'heartbeat',
} as const;
```

- [ ] **Step 2: Create `interfaces/batch-job-payload.interface.ts`**

```typescript
import { UserContext } from '../../interfaces/user-context.interface';

export interface BatchJobPayloadV2 {
  batchId: string;
  batchJobId: string;
  jobIndex: number;
  totalJobs: number;
  userId: string;
  jobPosition: string;
  companyName: string;
  jobDescription: string;
  templateId: string;
  resumeId?: string;
  userContext: UserContext;
}
```

- [ ] **Step 3: Create `interfaces/batch-sse-event.interface.ts`**

```typescript
import { BatchJobResult } from '../../dtos/batch-generate.dto';
import { BatchJobState } from '../../../../database/entities/batch-tailoring-job.entity';
import { BatchRunStatus } from '../../../../database/entities/batch-tailoring-run.entity';

export type ProcessingStage = 'analyzing' | 'optimizing' | 'finalizing';

export interface SnapshotEvent {
  batchId: string;
  totalJobs: number;
  status: BatchRunStatus;
  jobs: Array<{
    index: number;
    jobPosition: string;
    companyName: string;
    state: BatchJobState;
    result?: BatchJobResult;
    error?: string;
  }>;
}

export interface JobStartedEvent {
  batchId: string;
  jobIndex: number;
  stage: 'analyzing';
}

export interface JobProgressEvent {
  batchId: string;
  jobIndex: number;
  stage: ProcessingStage;
}

export interface JobCompletedEvent {
  batchId: string;
  jobIndex: number;
  result: BatchJobResult;
}

export interface JobFailedEvent {
  batchId: string;
  jobIndex: number;
  error: string;
}

export interface BatchCompletedEvent {
  batchId: string;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    totalProcessingTimeMs: number;
  };
}
```

- [ ] **Step 4: Build.** `npm run build` → 0 errors.

#### Task B2: Create the v2 events gateway (in-process pub-sub)

- **path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.events.gateway.ts`
- **intent:** RxJS Subject-based bridge between processor (publisher) and SSE controller (subscriber). Filtered by `batchId`.
- **verify:** `npm run build` passes.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`

Steps:

- [ ] **Step 1: Create the gateway service**

```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';

export interface BatchEventEnvelope {
  batchId: string;
  eventName: string;
  data: Record<string, unknown>;
  eventId: number;
}

@Injectable()
export class BatchTailoringV2EventsGateway implements OnModuleDestroy {
  private readonly logger = new Logger(BatchTailoringV2EventsGateway.name);
  private readonly stream$ = new Subject<BatchEventEnvelope>();

  publish(envelope: BatchEventEnvelope): void {
    this.logger.debug(
      `[batch ${envelope.batchId}] publish ${envelope.eventName} #${envelope.eventId}`,
    );
    this.stream$.next(envelope);
  }

  forBatch(batchId: string): Observable<BatchEventEnvelope> {
    return this.stream$.asObservable().pipe(
      filter((e) => e.batchId === batchId),
    );
  }

  onModuleDestroy(): void {
    this.stream$.complete();
  }
}
```

- [ ] **Step 2: Build.** `npm run build` → 0 errors.

#### Task B3: Create the v2 processor (Bull worker)

- **path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.processor.ts`
- **intent:** Execute one tailoring job per Bull job, with stage transitions, SSE emission, and final completion handling. Concurrency 3.
- **verify:** Build passes. Manual smoke: enqueue one job, watch logs cycle `analyzing → optimizing → finalizing → completed`, DB row updates, gateway emits 4 events.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`, `docs/API-PATTERNS.md`, `docs/ERROR-HANDLING.md`

Steps:

- [ ] **Step 1: Create the processor file**

```typescript
import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BatchTailoringJob } from '../../../database/entities/batch-tailoring-job.entity';
import { BatchTailoringRun } from '../../../database/entities/batch-tailoring-run.entity';
import { BatchTailoringV2EventsGateway } from './batch-tailoring-v2.events.gateway';
import { ResumeGenerationOrchestratorService } from '../services/resume-generation-orchestrator.service';
import {
  BATCH_TAILORING_V2_JOB_NAME,
  BATCH_TAILORING_V2_QUEUE,
  BATCH_V2_SSE_EVENT_NAMES,
  BATCH_V2_WORKER_CONCURRENCY,
} from './constants/batch-tailoring-v2.constants';
import { BatchJobPayloadV2 } from './interfaces/batch-job-payload.interface';

@Processor(BATCH_TAILORING_V2_QUEUE)
export class BatchTailoringV2Processor {
  private readonly logger = new Logger(BatchTailoringV2Processor.name);

  constructor(
    @InjectRepository(BatchTailoringJob)
    private readonly jobRepo: Repository<BatchTailoringJob>,
    @InjectRepository(BatchTailoringRun)
    private readonly runRepo: Repository<BatchTailoringRun>,
    private readonly orchestrator: ResumeGenerationOrchestratorService,
    private readonly events: BatchTailoringV2EventsGateway,
  ) {}

  @Process({ name: BATCH_TAILORING_V2_JOB_NAME, concurrency: BATCH_V2_WORKER_CONCURRENCY })
  async handle(job: Job<BatchJobPayloadV2>): Promise<void> {
    const startedAt = Date.now();
    const { batchId, batchJobId, jobIndex } = job.data;

    try {
      await this.transition(batchJobId, 'analyzing');
      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_STARTED, {
        batchId, jobIndex, stage: 'analyzing',
      });

      await this.transition(batchJobId, 'optimizing');
      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_PROGRESS, {
        batchId, jobIndex, stage: 'optimizing',
      });

      const result = await this.orchestrator.generateOptimizedResume({
        jobDescription: job.data.jobDescription,
        jobPosition: job.data.jobPosition,
        companyName: job.data.companyName,
        templateId: job.data.templateId,
        resumeId: job.data.resumeId,
        userContext: job.data.userContext,
      });

      await this.transition(batchJobId, 'finalizing');
      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_PROGRESS, {
        batchId, jobIndex, stage: 'finalizing',
      });

      await this.jobRepo.update(
        { id: batchJobId },
        {
          state: 'completed',
          resume_generation_id: result.resumeGenerationId,
          completed_at: new Date(),
        },
      );
      await this.bumpRunCounters(batchId, { completed: 1 });

      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_COMPLETED, {
        batchId, jobIndex,
        result: {
          jobPosition: job.data.jobPosition,
          companyName: job.data.companyName,
          status: 'success',
          resumeGenerationId: result.resumeGenerationId,
          pdfContent: result.pdfContent,
          filename: result.filename,
          optimizationConfidence: result.optimizationConfidence,
          keywordsAdded: result.keywordsAdded,
          sectionsChanged: result.sectionsChanged,
          matchScoreBefore: result.matchScoreBefore,
          matchScoreAfter: result.matchScoreAfter,
        },
      });

      await this.maybeFinishBatch(batchId, startedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Batch v2 job ${batchJobId} (index ${jobIndex}) failed: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );

      await this.jobRepo.update(
        { id: batchJobId },
        { state: 'failed', error_message: message, completed_at: new Date() },
      );
      await this.bumpRunCounters(batchId, { failed: 1 });

      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_FAILED, {
        batchId, jobIndex, error: message,
      });

      await this.maybeFinishBatch(batchId, startedAt);
    }
  }

  private async transition(
    batchJobId: string,
    state: 'analyzing' | 'optimizing' | 'finalizing',
  ): Promise<void> {
    const patch: Partial<BatchTailoringJob> = { state };
    if (state === 'analyzing') patch.started_at = new Date();
    await this.jobRepo.update({ id: batchJobId }, patch);
  }

  private async bumpRunCounters(
    batchId: string,
    delta: { completed?: number; failed?: number },
  ): Promise<void> {
    const updates: string[] = [];
    if (delta.completed) updates.push(`completed_jobs = completed_jobs + ${delta.completed}`);
    if (delta.failed) updates.push(`failed_jobs = failed_jobs + ${delta.failed}`);
    if (!updates.length) return;
    await this.runRepo.query(
      `UPDATE batch_tailoring_runs SET ${updates.join(', ')} WHERE id = $1`,
      [batchId],
    );
  }

  private async maybeFinishBatch(batchId: string, startedAt: number): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: batchId } });
    if (!run) return;
    const total = run.total_jobs;
    const done = run.completed_jobs + run.failed_jobs;
    if (done < total) return;

    const status =
      run.failed_jobs === 0
        ? 'completed'
        : run.completed_jobs === 0
          ? 'failed'
          : 'partial';

    await this.runRepo.update(
      { id: batchId },
      { status, completed_at: new Date() },
    );

    await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.BATCH_COMPLETED, {
      batchId,
      summary: {
        total,
        succeeded: run.completed_jobs,
        failed: run.failed_jobs,
        totalProcessingTimeMs: Date.now() - startedAt,
      },
    });
  }

  private async emit(
    batchId: string,
    eventName: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const result: Array<{ last_event_id: number }> = await this.runRepo.query(
      `UPDATE batch_tailoring_runs
       SET last_event_id = last_event_id + 1
       WHERE id = $1
       RETURNING last_event_id`,
      [batchId],
    );
    const eventId = result[0]?.last_event_id ?? 0;
    this.events.publish({ batchId, eventName, data, eventId });
  }
}
```

- [ ] **Step 2: Build.** `npm run build` → 0 errors.

#### Task B4: Wire v2 Bull queue in module

- **path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.module.ts`
- **intent:** NestJS module that registers the v2 queue, processor, gateway, and TypeORM entities.
- **verify:** App boots; logs show `BatchTailoringV2Processor initialized` and `Queue 'batch_tailoring_v2' connected`.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`, `docs/ARCHITECTURE.md`

Steps:

- [ ] **Step 1: Create the module file**

```typescript
import { BullModule } from '@nestjs/bull';
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BatchTailoringRun } from '../../../database/entities/batch-tailoring-run.entity';
import { BatchTailoringJob } from '../../../database/entities/batch-tailoring-job.entity';
import { BatchTailoringV2EventsGateway } from './batch-tailoring-v2.events.gateway';
import { BatchTailoringV2Processor } from './batch-tailoring-v2.processor';
import { BatchTailoringV2Service } from './batch-tailoring-v2.service';
import { BatchTailoringV2Controller } from './batch-tailoring-v2.controller';
import { BATCH_TAILORING_V2_QUEUE } from './constants/batch-tailoring-v2.constants';
import { ResumeTailoringModule } from '../resume-tailoring.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: BATCH_TAILORING_V2_QUEUE }),
    TypeOrmModule.forFeature([BatchTailoringRun, BatchTailoringJob]),
    forwardRef(() => ResumeTailoringModule),
  ],
  controllers: [BatchTailoringV2Controller],
  providers: [
    BatchTailoringV2Service,
    BatchTailoringV2Processor,
    BatchTailoringV2EventsGateway,
  ],
  exports: [BatchTailoringV2Service],
})
export class BatchTailoringV2Module {}
```

> NOTE: `ResumeTailoringModule` must export `ResumeGenerationOrchestratorService` for the processor to inject it. Verify and add to its `exports[]` if not already there. The processor depends on the orchestrator only — no direct diff service or job analysis dependency.

- [ ] **Step 2: Register `BatchTailoringV2Module`** in `ResumeTailoringModule.imports[]` (or `AppModule.imports[]` if that's the convention used by `changes_diff` queue).

- [ ] **Step 3: Build & boot.** `npm run start:dev`. Expected logs: queue connection established, processor initialized.

---

### Phase C — Backend: v2 service + controller + SSE

#### Task C1: Create `BatchTailoringV2Service.enqueueBatch`

- **path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts`
- **intent:** Validate input (≤3 jobs), create batch run + job rows in a single transaction, enqueue Bull jobs, return `{ batchId, totalJobs }`.
- **verify:** Build passes. Manual: call `POST /resume-tailoring/batch/v2/generate` with 2 jobs, observe in DB: 1 row in `batch_tailoring_runs`, 2 in `batch_tailoring_jobs`, 2 Bull jobs in `batch_tailoring_v2` queue.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`, `docs/API-PATTERNS.md`, `docs/ERROR-HANDLING.md`

Steps:

- [ ] **Step 1: Create the service file**

```typescript
import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { DataSource, Repository } from 'typeorm';
import { BatchTailoringRun } from '../../../database/entities/batch-tailoring-run.entity';
import { BatchTailoringJob } from '../../../database/entities/batch-tailoring-job.entity';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import {
  BadRequestException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import {
  BATCH_V2_MAX_JOBS,
  BATCH_TAILORING_V2_JOB_NAME,
  BATCH_TAILORING_V2_QUEUE,
} from './constants/batch-tailoring-v2.constants';
import { BatchJobPayloadV2 } from './interfaces/batch-job-payload.interface';
import { SnapshotEvent } from './interfaces/batch-sse-event.interface';
import { UserContext } from '../interfaces/user-context.interface';
import { BatchJobInput, BatchJobResult } from '../dtos/batch-generate.dto';

@Injectable()
export class BatchTailoringV2Service {
  private readonly logger = new Logger(BatchTailoringV2Service.name);

  constructor(
    @InjectQueue(BATCH_TAILORING_V2_QUEUE) private readonly queue: Queue,
    @InjectRepository(BatchTailoringRun)
    private readonly runRepo: Repository<BatchTailoringRun>,
    @InjectRepository(BatchTailoringJob)
    private readonly jobRepo: Repository<BatchTailoringJob>,
    private readonly dataSource: DataSource,
  ) {}

  async enqueueBatch(args: {
    userContext: UserContext;
    jobs: BatchJobInput[];
    templateId: string;
    resumeId?: string;
  }): Promise<{ batchId: string; totalJobs: number }> {
    if (!args.jobs.length) {
      throw new BadRequestException(
        'At least one job is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }
    if (args.jobs.length > BATCH_V2_MAX_JOBS) {
      throw new BadRequestException(
        `Batch size exceeds limit of ${BATCH_V2_MAX_JOBS}`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const { batchId, jobRecords } = await this.dataSource.transaction(
      async (mgr) => {
        const run = mgr.create(BatchTailoringRun, {
          user_id: args.userContext.userId,
          template_id: args.templateId,
          resume_id: args.resumeId ?? null,
          total_jobs: args.jobs.length,
          status: 'queued',
        });
        const savedRun = await mgr.save(run);

        const records = args.jobs.map((j, idx) =>
          mgr.create(BatchTailoringJob, {
            batch_id: savedRun.id,
            job_index: idx,
            job_position: j.jobPosition,
            company_name: j.companyName,
            job_description: j.jobDescription,
            state: 'queued',
          }),
        );
        const savedJobs = await mgr.save(records);

        return { batchId: savedRun.id, jobRecords: savedJobs };
      },
    );

    for (const record of jobRecords) {
      const payload: BatchJobPayloadV2 = {
        batchId,
        batchJobId: record.id,
        jobIndex: record.job_index,
        totalJobs: args.jobs.length,
        userId: args.userContext.userId,
        jobPosition: record.job_position,
        companyName: record.company_name,
        jobDescription: record.job_description,
        templateId: args.templateId,
        resumeId: args.resumeId,
        userContext: args.userContext,
      };
      await this.queue.add(BATCH_TAILORING_V2_JOB_NAME, payload, {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 86400 },
      });
    }

    this.logger.log(
      `Enqueued batch ${batchId} with ${args.jobs.length} jobs for user ${args.userContext.userId}`,
    );

    return { batchId, totalJobs: args.jobs.length };
  }

  async getSnapshot(
    batchId: string,
    userId: string,
  ): Promise<SnapshotEvent> {
    const run = await this.runRepo.findOne({
      where: { id: batchId, user_id: userId },
    });
    if (!run) {
      throw new NotFoundException('Batch not found', ERROR_CODES.NOT_FOUND);
    }
    const jobs = await this.jobRepo.find({
      where: { batch_id: batchId },
      relations: ['resume_generation'],
      order: { job_index: 'ASC' },
    });

    return {
      batchId: run.id,
      totalJobs: run.total_jobs,
      status: run.status,
      jobs: jobs.map((j) => ({
        index: j.job_index,
        jobPosition: j.job_position,
        companyName: j.company_name,
        state: j.state,
        result: j.state === 'completed' ? this.toResult(j) : undefined,
        error: j.error_message ?? undefined,
      })),
    };
  }

  private toResult(job: BatchTailoringJob): BatchJobResult {
    const rg = job.resume_generation;
    return {
      jobPosition: job.job_position,
      companyName: job.company_name,
      status: 'success',
      resumeGenerationId: rg?.id,
      keywordsAdded: rg?.keywords_added ?? 0,
      sectionsChanged: this.extractSectionsChanged(rg),
      matchScoreBefore: rg?.match_score_before ?? undefined,
      matchScoreAfter: rg?.match_score_after ?? undefined,
    };
  }

  private extractSectionsChanged(rg: ResumeGeneration | null): number {
    if (!rg?.changes_diff) return 0;
    return (rg.changes_diff as { sectionsChanged?: number }).sectionsChanged ?? 0;
  }
}
```

- [ ] **Step 2: Build.** `npm run build` → 0 errors.

#### Task C2: Create `BatchTailoringV2Controller` — POST endpoint

- **path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.controller.ts`, `.../dto/enqueue-batch-v2.dto.ts`
- **intent:** `POST /resume-tailoring/batch/v2/generate` accepts batch input, validates, calls service, returns 202 Accepted.
- **verify:** `npm run build` passes; `curl -X POST` with valid payload returns `202` with the expected JSON shape; with 4 jobs returns 400.
- **agency:** `Backend Architect`
- **docs:** `docs/API-PATTERNS.md`, `docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Create `dto/enqueue-batch-v2.dto.ts`**

```typescript
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BATCH_V2_MAX_JOBS } from '../constants/batch-tailoring-v2.constants';

export class EnqueueBatchV2JobDto {
  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(255)
  jobPosition: string;

  @ApiProperty()
  @IsString() @MinLength(1) @MaxLength(255)
  companyName: string;

  @ApiProperty()
  @IsString() @MinLength(20)
  jobDescription: string;
}

export class EnqueueBatchV2Dto {
  @ApiProperty({ type: [EnqueueBatchV2JobDto], maxItems: BATCH_V2_MAX_JOBS })
  @IsArray()
  @ArrayMinSize(1) @ArrayMaxSize(BATCH_V2_MAX_JOBS)
  @ValidateNested({ each: true })
  @Type(() => EnqueueBatchV2JobDto)
  jobs: EnqueueBatchV2JobDto[];

  @ApiProperty() @IsUUID()
  templateId: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID()
  resumeId?: string;
}

export class EnqueueBatchV2ResponseDto {
  @ApiProperty() batchId: string;
  @ApiProperty() totalJobs: number;
}
```

- [ ] **Step 2: Create the controller (POST only — SSE in C3, status in C4)**

```typescript
import {
  Body, Controller, HttpCode, HttpStatus, Post, UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserContext } from '../interfaces/user-context.interface';
import { BatchTailoringV2Service } from './batch-tailoring-v2.service';
import {
  EnqueueBatchV2Dto, EnqueueBatchV2ResponseDto,
} from './dto/enqueue-batch-v2.dto';

@ApiTags('Resume Tailoring (Batch v2)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('resume-tailoring/batch/v2')
export class BatchTailoringV2Controller {
  constructor(private readonly batchService: BatchTailoringV2Service) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Enqueue a batch tailoring run (1-3 jobs, async)' })
  @ApiResponse({ status: 202, type: EnqueueBatchV2ResponseDto })
  async enqueue(
    @Body() dto: EnqueueBatchV2Dto,
    @CurrentUser() user: UserContext,
  ): Promise<EnqueueBatchV2ResponseDto> {
    return this.batchService.enqueueBatch({
      userContext: user,
      jobs: dto.jobs,
      templateId: dto.templateId,
      resumeId: dto.resumeId,
    });
  }
}
```

- [ ] **Step 3: Manual test.**
  ```bash
  curl -X POST http://localhost:3000/resume-tailoring/batch/v2/generate \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"templateId":"...","jobs":[{"jobPosition":"SWE","companyName":"X","jobDescription":"valid description >20 chars"}]}'
  ```
  Expected: `202` with `{ "batchId": "uuid", "totalJobs": 1 }` in <500ms. With 4 jobs: `400`.

#### Task C3: Add SSE endpoint to `BatchTailoringV2Controller`

- **path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.controller.ts`
- **intent:** `GET /resume-tailoring/batch/v2/:batchId/events` opens SSE. On open: send `snapshot` with current state. Then forward all `BatchEventEnvelope`s for that `batchId`. Heartbeat every 20s. Closes after `batch_completed`.
- **verify:** `curl -N` shows snapshot then live events as worker progresses; heartbeat arrives every 20s when idle.
- **agency:** `Backend Architect`
- **docs:** `docs/API-PATTERNS.md`

Steps:

- [ ] **Step 1: Add the SSE method**

```typescript
import { Get, Param, Sse, MessageEvent } from '@nestjs/common';
import { Observable, concat, of, merge, interval, map } from 'rxjs';
import { BatchTailoringV2EventsGateway } from './batch-tailoring-v2.events.gateway';
import {
  BATCH_V2_HEARTBEAT_MS,
  BATCH_V2_SSE_EVENT_NAMES,
} from './constants/batch-tailoring-v2.constants';

// Update controller constructor:
constructor(
  private readonly batchService: BatchTailoringV2Service,
  private readonly events: BatchTailoringV2EventsGateway,
) {}

@Sse(':batchId/events')
@ApiOperation({ summary: 'SSE stream of batch processing events' })
async stream(
  @Param('batchId') batchId: string,
  @CurrentUser() user: UserContext,
): Promise<Observable<MessageEvent>> {
  const snapshot = await this.batchService.getSnapshot(batchId, user.userId);

  const initial$: Observable<MessageEvent> = of({
    type: BATCH_V2_SSE_EVENT_NAMES.SNAPSHOT,
    data: snapshot,
    id: '0',
  } as MessageEvent);

  const live$: Observable<MessageEvent> = this.events.forBatch(batchId).pipe(
    map((env) => ({
      type: env.eventName,
      data: env.data,
      id: String(env.eventId),
    } as MessageEvent)),
  );

  const heartbeat$: Observable<MessageEvent> = interval(BATCH_V2_HEARTBEAT_MS).pipe(
    map(() => ({
      type: BATCH_V2_SSE_EVENT_NAMES.HEARTBEAT,
      data: { ts: Date.now() },
    } as MessageEvent)),
  );

  return merge(concat(initial$, live$), heartbeat$);
}
```

- [ ] **Step 2: Manual SSE test.**
  ```bash
  # Terminal 1: enqueue, capture batchId
  # Terminal 2:
  curl -N -H "Authorization: Bearer $TOKEN" \
    http://localhost:3000/resume-tailoring/batch/v2/$BATCH_ID/events
  ```
  Expected: `event: snapshot\ndata: {...}\n\n` immediately, then live events. Heartbeats every 20s when no activity.

#### Task C4: Add polling fallback endpoint

- **path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.controller.ts`, `.../dto/batch-status-v2.dto.ts`
- **intent:** `GET /resume-tailoring/batch/v2/:batchId/status` returns identical snapshot shape. Safety net for environments where SSE is blocked.
- **verify:** `curl` returns the same JSON as SSE's first `snapshot` event.
- **agency:** `Backend Architect`
- **docs:** `docs/API-PATTERNS.md`

Steps:

- [ ] **Step 1: Add the GET method**

```typescript
@Get(':batchId/status')
@ApiOperation({ summary: 'Polling fallback — current batch state' })
async status(
  @Param('batchId') batchId: string,
  @CurrentUser() user: UserContext,
): Promise<SnapshotEvent> {
  return this.batchService.getSnapshot(batchId, user.userId);
}
```

- [ ] **Step 2: Create `dto/batch-status-v2.dto.ts`** as a Swagger-annotated mirror of `SnapshotEvent` (for OpenAPI docs only).

- [ ] **Step 3: Manual test.** `curl` the new endpoint mid-flight, compare to SSE's snapshot.

---

### Phase D — Frontend: data layer (v2-namespaced)

#### Task D1: Create v2 model

- **path:** `src/app/features/tailor-apply/models/batch-tailoring-v2.model.ts`
- **intent:** All new types live in a v2 file so v1's `batch-tailoring.model.ts` stays untouched.
- **verify:** `npm run build` passes.
- **agency:** `engineering-frontend-developer`
- **docs:** `docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Create the model file**

```typescript
import { BatchJobResult } from './batch-tailoring.model';

export type BatchJobState =
  | 'queued'
  | 'analyzing'
  | 'optimizing'
  | 'finalizing'
  | 'completed'
  | 'failed';

export type BatchRunStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed';

export interface BatchJobLiveState {
  index: number;
  jobPosition: string;
  companyName: string;
  state: BatchJobState;
  result?: BatchJobResult;
  error?: string;
}

export interface BatchSnapshot {
  batchId: string;
  totalJobs: number;
  status: BatchRunStatus;
  jobs: BatchJobLiveState[];
}

export interface EnqueueBatchV2Response {
  batchId: string;
  totalJobs: number;
}

export type BatchV2SseEventName =
  | 'snapshot'
  | 'job_started'
  | 'job_progress'
  | 'job_completed'
  | 'job_failed'
  | 'batch_completed'
  | 'heartbeat';
```

> Modal step type lives in v1 `batch-tailoring.model.ts`. Update it (additive only, keep `'generating'` for v1 fallback):
>
> ```typescript
> export type BatchTailoringStep = 'input' | 'generating' | 'processing' | 'results';
> ```

- [ ] **Step 2: Build.** `npm run build` → 0 errors.

#### Task D2: Create `BatchTailoringV2EventsService` — SSE wrapper

- **path:** `src/app/features/tailor-apply/services/batch-tailoring-events-v2.service.ts`
- **intent:** Wraps `EventSource`. Exposes typed `Observable<BatchSseEvent>` per batch + `connectionStatus` signal.
- **verify:** Build passes; manual: connect to a live batch, observe events log + status changes in console.
- **agency:** `engineering-frontend-developer`
- **docs:** `docs/CONVENTIONS.md`, `docs/API-PATTERNS.md`

Steps:

- [ ] **Step 1: Create the service**

```typescript
import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { BatchV2SseEventName } from '../models/batch-tailoring-v2.model';

export interface BatchV2SseEvent {
  name: BatchV2SseEventName;
  data: unknown;
}

export type BatchConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

@Injectable({ providedIn: 'root' })
export class BatchTailoringV2EventsService {
  private readonly zone = inject(NgZone);

  readonly connectionStatus = signal<BatchConnectionStatus>('closed');

  open(batchId: string, accessToken: string): Observable<BatchV2SseEvent> {
    const subject = new Subject<BatchV2SseEvent>();
    let source: EventSource | null = null;

    const url =
      `${environment.apiBaseUrl}/resume-tailoring/batch/v2/${batchId}/events` +
      `?access_token=${encodeURIComponent(accessToken)}`;

    const connect = () => {
      this.connectionStatus.set('connecting');
      source = new EventSource(url, { withCredentials: true });

      source.onopen = () => {
        this.zone.run(() => this.connectionStatus.set('open'));
      };

      const eventNames: BatchV2SseEventName[] = [
        'snapshot', 'job_started', 'job_progress',
        'job_completed', 'job_failed', 'batch_completed', 'heartbeat',
      ];
      for (const name of eventNames) {
        source.addEventListener(name, (e) => {
          const messageEvent = e as MessageEvent;
          this.zone.run(() => {
            try {
              subject.next({ name, data: JSON.parse(messageEvent.data) });
              if (name === 'batch_completed') {
                source?.close();
                this.connectionStatus.set('closed');
                subject.complete();
              }
            } catch (err) {
              console.error('SSE parse error', err);
            }
          });
        });
      }

      source.onerror = () => {
        this.zone.run(() => this.connectionStatus.set('reconnecting'));
      };
    };

    connect();

    return new Observable<BatchV2SseEvent>((sub) => {
      const inner = subject.subscribe(sub);
      return () => {
        inner.unsubscribe();
        source?.close();
        this.connectionStatus.set('closed');
      };
    });
  }
}
```

- [ ] **Step 2: Build.** `npm run build` → 0 errors.

#### Task D3: Create `BatchTailoringV2Service`

- **path:** `src/app/features/tailor-apply/services/batch-tailoring-v2.service.ts`
- **intent:** Two methods: `enqueueBatch(payload)` (POST returns `{ batchId, totalJobs }`) and `getStatus(batchId)` (GET snapshot for polling fallback). Reuses existing `buildBlob` from v1 service.
- **verify:** Build passes. Manual: call `enqueueBatch` from console — receives `{ batchId, totalJobs }` in <500ms.
- **agency:** `engineering-frontend-developer`
- **docs:** `docs/API-PATTERNS.md`

Steps:

- [ ] **Step 1: Create the service**

```typescript
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  BatchGenerateRequest,
  BatchJobResult,
} from '../models/batch-tailoring.model';
import {
  BatchSnapshot,
  EnqueueBatchV2Response,
} from '../models/batch-tailoring-v2.model';
import { BatchTailoringService } from './batch-tailoring.service';

@Injectable({ providedIn: 'root' })
export class BatchTailoringV2Service {
  private readonly http = inject(HttpClient);
  private readonly v1 = inject(BatchTailoringService);

  enqueueBatch(payload: BatchGenerateRequest): Observable<EnqueueBatchV2Response> {
    return this.http.post<EnqueueBatchV2Response>(
      `${environment.apiBaseUrl}/resume-tailoring/batch/v2/generate`,
      payload,
    );
  }

  getStatus(batchId: string): Observable<BatchSnapshot> {
    return this.http.get<BatchSnapshot>(
      `${environment.apiBaseUrl}/resume-tailoring/batch/v2/${batchId}/status`,
    );
  }

  /** Reuse v1's blob builder — identical behavior. */
  buildBlob(result: BatchJobResult): Blob | null {
    return this.v1.buildBlob(result);
  }
}
```

- [ ] **Step 2: Build.** `npm run build` → 0 errors.

#### Task D4: Create `BatchTailoringV2State` — signals state machine

- **path:** `src/app/features/tailor-apply/state/batch-tailoring-v2.state.ts`
- **intent:** Owns the current `BatchSnapshot`, derived counters, batch status. Components read + react.
- **verify:** Build passes.
- **agency:** `engineering-frontend-developer`
- **docs:** `docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Create the state class**

```typescript
import { computed, signal } from '@angular/core';
import {
  BatchJobLiveState,
  BatchSnapshot,
  BatchV2SseEventName,
} from '../models/batch-tailoring-v2.model';

export class BatchTailoringV2State {
  private readonly _snapshot = signal<BatchSnapshot | null>(null);
  readonly snapshot = this._snapshot.asReadonly();

  readonly completedCount = computed(
    () => this._snapshot()?.jobs.filter((j) => j.state === 'completed').length ?? 0,
  );
  readonly failedCount = computed(
    () => this._snapshot()?.jobs.filter((j) => j.state === 'failed').length ?? 0,
  );
  readonly totalCount = computed(() => this._snapshot()?.totalJobs ?? 0);
  readonly progressPct = computed(() => {
    const total = this.totalCount();
    if (!total) return 0;
    const done = this.completedCount() + this.failedCount();
    return Math.round((done / total) * 100);
  });
  readonly isComplete = computed(() => {
    const s = this._snapshot()?.status;
    return s === 'completed' || s === 'partial' || s === 'failed';
  });

  applySnapshot(snap: BatchSnapshot): void {
    this._snapshot.set(snap);
  }

  applyEvent(eventName: BatchV2SseEventName, data: unknown): void {
    if (!this._snapshot()) return;

    switch (eventName) {
      case 'snapshot':
        this._snapshot.set(data as BatchSnapshot);
        return;
      case 'job_started': {
        const e = data as { jobIndex: number };
        this.patchJob(e.jobIndex, { state: 'analyzing' });
        return;
      }
      case 'job_progress': {
        const e = data as { jobIndex: number; stage: BatchJobLiveState['state'] };
        this.patchJob(e.jobIndex, { state: e.stage });
        return;
      }
      case 'job_completed': {
        const e = data as { jobIndex: number; result: BatchJobLiveState['result'] };
        this.patchJob(e.jobIndex, { state: 'completed', result: e.result });
        return;
      }
      case 'job_failed': {
        const e = data as { jobIndex: number; error: string };
        this.patchJob(e.jobIndex, { state: 'failed', error: e.error });
        return;
      }
      case 'batch_completed': {
        const snap = this._snapshot()!;
        this._snapshot.set({ ...snap, status: this.deriveBatchStatus() });
        return;
      }
    }
  }

  private patchJob(index: number, patch: Partial<BatchJobLiveState>): void {
    const snap = this._snapshot();
    if (!snap) return;
    const jobs = snap.jobs.map((j) =>
      j.index === index ? { ...j, ...patch } : j,
    );
    this._snapshot.set({ ...snap, jobs });
  }

  private deriveBatchStatus(): BatchSnapshot['status'] {
    const failed = this.failedCount();
    const completed = this.completedCount();
    const total = this.totalCount();
    if (failed === total) return 'failed';
    if (failed > 0 && completed > 0) return 'partial';
    if (completed === total) return 'completed';
    return 'processing';
  }
}
```

- [ ] **Step 2: Build.** `npm run build` → 0 errors.

---

### Phase E — Frontend: UI components

#### Task E1: Create `BatchJobCardComponent`

- **path:** `src/app/features/tailor-apply/components/batch-job-card/batch-job-card.component.ts`, `.html`
- **intent:** One component renders one job row across all 6 states. Reuses match-score row for `completed`. Emits `download`, `seeChanges`, `retry`.
- **verify:** Build passes; visual: all 6 states render correctly when fed mock data.
- **agency:** `engineering-frontend-developer`
- **docs:** `docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Create the component class**

```typescript
import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { BatchJobLiveState } from '../../models/batch-tailoring-v2.model';

@Component({
  selector: 'app-batch-job-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './batch-job-card.component.html',
})
export class BatchJobCardComponent {
  job = input.required<BatchJobLiveState>();
  download = output<BatchJobLiveState>();
  seeChanges = output<BatchJobLiveState>();
  retry = output<BatchJobLiveState>();
}
```

- [ ] **Step 2: Create the template**

```html
<div
  class="flex items-center gap-3 p-4 rounded-2xl border transition-all"
  [class.bg-white]="job().state !== 'failed'"
  [class.border-slate-200]="job().state !== 'failed'"
  [class.bg-red-50]="job().state === 'failed'"
  [class.border-red-200]="job().state === 'failed'">

  <div class="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center"
    [ngClass]="{
      'bg-slate-100': job().state === 'queued',
      'bg-blue-100': job().state === 'analyzing' || job().state === 'finalizing',
      'bg-purple-100': job().state === 'optimizing',
      'bg-success-softer': job().state === 'completed',
      'bg-red-100': job().state === 'failed'
    }">
    @switch (job().state) {
      @case ('queued') { <span class="text-slate-400 text-lg">⋯</span> }
      @case ('completed') {
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" class="text-success">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      }
      @case ('failed') {
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2.5" class="text-red-500">
          <path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>
        </svg>
      }
      @default {
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" class="animate-spin"
          [class.text-blue-500]="job().state === 'analyzing' || job().state === 'finalizing'"
          [class.text-purple-500]="job().state === 'optimizing'">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
        </svg>
      }
    }
  </div>

  <div class="flex-1 min-w-0">
    <p class="text-sm font-semibold text-slate-800 truncate">
      {{ job().jobPosition }}
      <span class="text-slate-400 font-normal">&#64; {{ job().companyName }}</span>
    </p>

    @switch (job().state) {
      @case ('queued')      { <p class="text-xs text-slate-400 mt-0.5">Queued — starting soon</p> }
      @case ('analyzing')   { <p class="text-xs text-blue-500 mt-0.5">Analyzing job requirements... (1/3)</p> }
      @case ('optimizing')  { <p class="text-xs text-purple-500 mt-0.5">Tailoring resume content... (2/3)</p> }
      @case ('finalizing')  { <p class="text-xs text-blue-500 mt-0.5">Generating PDF... (3/3)</p> }
      @case ('completed') {
        <p class="text-xs text-slate-500 mt-0.5">
          @if (job().result?.matchScoreBefore != null && job().result?.matchScoreAfter != null
               && job().result!.matchScoreAfter! > job().result!.matchScoreBefore!) {
            <span class="text-slate-400">{{ job().result!.matchScoreBefore }}%</span>
            <span class="text-slate-300 mx-1" aria-hidden="true">→</span>
            <span class="text-success-strong font-semibold">{{ job().result!.matchScoreAfter }}% match</span>
          } @else if (job().result?.matchScoreAfter != null) {
            <span class="text-success-strong font-semibold">{{ job().result!.matchScoreAfter }}% match</span>
          }
          @if (job().result?.matchScoreAfter != null && job().result?.sectionsChanged != null) {
            <span class="text-slate-300 mx-1.5" aria-hidden="true">·</span>
          }
          @if (job().result?.sectionsChanged != null) {
            <span>{{ job().result!.sectionsChanged }} section{{ job().result!.sectionsChanged !== 1 ? 's' : '' }} updated</span>
          }
        </p>
      }
      @case ('failed') { <p class="text-xs text-red-500 mt-0.5">{{ job().error }}</p> }
    }
  </div>

  <div class="flex items-center gap-1.5 shrink-0">
    @if (job().state === 'completed') {
      <button (click)="seeChanges.emit(job())"
        class="h-8 px-2.5 rounded-xl border border-primary-soft-border text-xs font-medium text-primary hover:bg-primary-soft transition-all">
        See changes
      </button>
      <button (click)="download.emit(job())"
        class="h-8 px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-600 hover:text-primary hover:border-primary-soft-border hover:bg-primary-soft transition-all">
        Download
      </button>
    }
    @if (job().state === 'failed') {
      <button (click)="retry.emit(job())"
        class="h-8 px-3 rounded-xl border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50 transition-all">
        Retry
      </button>
    }
  </div>
</div>
```

- [ ] **Step 3: Build.** `npm run build` → 0 errors.

#### Task E2: Create `BatchProcessingViewComponent`

- **path:** `src/app/features/tailor-apply/components/batch-processing-view/batch-processing-view.component.ts`, `.html`
- **intent:** Header (title + completed/total + ETA + progress bar), `Reconnecting…` banner, list of `BatchJobCardComponent` rows.
- **verify:** Build passes.
- **agency:** `engineering-frontend-developer`
- **docs:** `docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Create the component class**

```typescript
import { CommonModule } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import { BatchTailoringV2State } from '../../state/batch-tailoring-v2.state';
import { BatchJobLiveState } from '../../models/batch-tailoring-v2.model';
import { BatchConnectionStatus } from '../../services/batch-tailoring-events-v2.service';
import { BatchJobCardComponent } from '../batch-job-card/batch-job-card.component';
import { Signal } from '@angular/core';

@Component({
  selector: 'app-batch-processing-view',
  standalone: true,
  imports: [CommonModule, BatchJobCardComponent],
  templateUrl: './batch-processing-view.component.html',
})
export class BatchProcessingViewComponent {
  state = input.required<BatchTailoringV2State>();
  connectionStatus = input.required<Signal<BatchConnectionStatus>>();

  download = output<BatchJobLiveState>();
  seeChanges = output<BatchJobLiveState>();
  retry = output<BatchJobLiveState>();

  readonly etaSeconds = computed(() => {
    const s = this.state().snapshot();
    if (!s) return 0;
    const remaining = s.jobs.filter((j) =>
      j.state === 'queued' || j.state === 'analyzing' ||
      j.state === 'optimizing' || j.state === 'finalizing'
    ).length;
    return remaining * 15;
  });
}
```

- [ ] **Step 2: Create the template**

```html
<div class="space-y-5">
  @if (connectionStatus()() === 'reconnecting') {
    <div class="flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
      <svg class="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
      </svg>
      Reconnecting…
    </div>
  }

  <div class="flex flex-col items-center gap-3 text-center">
    <div>
      <h3 class="text-xl font-bold text-slate-900">Tailoring Your Resumes</h3>
      <p class="text-xs text-slate-500 mt-1">
        {{ state().completedCount() }} of {{ state().totalCount() }} complete
        @if (etaSeconds() > 0) { · ~{{ etaSeconds() }}s remaining }
      </p>
    </div>

    <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
      <div class="h-full bg-gradient-to-r from-accent-purple to-primary transition-all duration-400 ease-out"
        [style.width.%]="state().progressPct()">
      </div>
    </div>
  </div>

  <div class="space-y-2">
    @for (job of state().snapshot()?.jobs ?? []; track job.index) {
      <app-batch-job-card
        [job]="job"
        (download)="download.emit($event)"
        (seeChanges)="seeChanges.emit($event)"
        (retry)="retry.emit($event)" />
    }
  </div>
</div>
```

- [ ] **Step 3: Build.** `npm run build` → 0 errors.

#### Task E3: Wire `BatchTailoringModalComponent` to v2

- **path:** `src/app/features/tailor-apply/batch-tailoring-modal.component.ts`, `.html`
- **intent:** Switch the actual submission target from v1 service to v2 service. Add `'processing'` step rendering `<app-batch-processing-view>`. Keep results step rendering existing `<app-batch-results>` — that component already handles the final state.
- **verify:** Build passes. End-to-end manual test: submit 2-job batch, modal transitions through input → processing (live updates) → results.
- **agency:** `engineering-frontend-developer`
- **docs:** `docs/CONVENTIONS.md`, `docs/API-PATTERNS.md`

Steps:

- [ ] **Step 1: Inject v2 services + create state holder.**

```typescript
private readonly v2Service = inject(BatchTailoringV2Service);
private readonly v2Events = inject(BatchTailoringV2EventsService);
private readonly auth = inject(AuthService);

readonly batchState = new BatchTailoringV2State();
private sseSub?: Subscription;
private pollSub?: Subscription;
private batchId?: string;
```

- [ ] **Step 2: Replace the existing submission method** to call v2:

```typescript
submitBatch(req: BatchGenerateRequest): void {
  this.step.set('processing');
  this.v2Service.enqueueBatch(req).subscribe({
    next: ({ batchId }) => {
      this.batchId = batchId;
      this.openSse(batchId);
    },
    error: (err) => {
      this.snackbar.showError('Failed to start batch: ' + err.message);
      this.step.set('input');
    },
  });
}

private openSse(batchId: string): void {
  const token = this.auth.getAccessToken();
  this.sseSub = this.v2Events.open(batchId, token).subscribe({
    next: ({ name, data }) => {
      if (name === 'snapshot') {
        this.batchState.applySnapshot(data as BatchSnapshot);
      } else {
        this.batchState.applyEvent(name, data);
      }
      if (name === 'batch_completed') this.transitionToResults();
    },
    error: () => this.startPolling(),
  });
}

private transitionToResults(): void {
  const snap = this.batchState.snapshot();
  if (!snap) return;
  this.batchResponse.set(this.snapshotToResponse(snap));
  this.step.set('results');
}

private snapshotToResponse(snap: BatchSnapshot): BatchGenerateResponse {
  return {
    batchId: snap.batchId,
    results: snap.jobs.map((j) =>
      j.state === 'completed'
        ? { ...j.result!, status: 'success' as const }
        : { jobPosition: j.jobPosition, companyName: j.companyName,
            status: 'failed' as const, error: j.error ?? 'Unknown' },
    ),
    summary: {
      total: snap.totalJobs,
      succeeded: snap.jobs.filter((j) => j.state === 'completed').length,
      failed: snap.jobs.filter((j) => j.state === 'failed').length,
      totalProcessingTimeMs: 0,
    },
  };
}
```

- [ ] **Step 3: Replace the `'generating'` template branch** with `'processing'`. v1's `'generating'` stays available as a fallback step name but no longer reachable via the new submit path.

```html
@case ('processing') {
  <app-batch-processing-view
    [state]="batchState"
    [connectionStatus]="v2Events.connectionStatus"
    (download)="onDownloadJob($event)"
    (seeChanges)="onSeeChanges($event)"
    (retry)="onRetry($event)" />
}
```

- [ ] **Step 4: Implement event handler methods.**

```typescript
onDownloadJob(job: BatchJobLiveState): void {
  if (!job.result) return;
  const blob = this.v2Service.buildBlob(job.result);
  if (!blob) return;
  const filename = buildDownloadFilename(
    job.result.jobPosition ?? '',
    this.userState.currentUser()?.fullName ?? '',
  );
  saveAs(blob, filename);
}

onSeeChanges(job: BatchJobLiveState): void {
  if (job.result?.resumeGenerationId) {
    this.activeComparisonId.set(job.result.resumeGenerationId);
  }
}

onRetry(_job: BatchJobLiveState): void {
  this.snackbar.showInfo('Retry not yet implemented — re-run via Tailor Another Set.');
}
```

- [ ] **Step 5: Add `OnDestroy` cleanup.**

```typescript
ngOnDestroy(): void {
  this.sseSub?.unsubscribe();
  this.pollSub?.unsubscribe();
}
```

- [ ] **Step 6: Manual e2e test.** Submit a 2-job batch, verify:
  - Modal shows processing view in <500ms
  - Each job card cycles through states
  - First completed job shows download/see-changes immediately
  - Modal transitions to results view at batch_completed
  - Download All ZIP works (existing batch-results component)
  - Done button still closes (already auto-tracks per earlier change)

#### Task E4: Add polling fallback when SSE stays disconnected

- **path:** `src/app/features/tailor-apply/batch-tailoring-modal.component.ts`
- **intent:** When `connectionStatus()` is `reconnecting` for >10s, fall back to polling `getStatus(batchId)` every 2s until SSE recovers or batch completes.
- **verify:** Block SSE in DevTools → polling kicks in after 10s, UI keeps updating.
- **agency:** `engineering-frontend-developer`
- **docs:** `docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Add the effect + start/stop polling helpers**

```typescript
constructor() {
  effect(() => {
    const status = this.v2Events.connectionStatus();
    if (status !== 'reconnecting') {
      this.stopPolling();
      return;
    }
    setTimeout(() => {
      if (this.v2Events.connectionStatus() === 'reconnecting') {
        this.startPolling();
      }
    }, 10_000);
  });
}

private startPolling(): void {
  if (this.pollSub || !this.batchId) return;
  const id = this.batchId;
  this.pollSub = interval(2000).pipe(
    switchMap(() => this.v2Service.getStatus(id)),
  ).subscribe((snap) => {
    this.batchState.applySnapshot(snap);
    if (snap.status === 'completed' || snap.status === 'partial' || snap.status === 'failed') {
      this.transitionToResults();
    }
  });
}

private stopPolling(): void {
  this.pollSub?.unsubscribe();
  this.pollSub = undefined;
}
```

- [ ] **Step 2: Build & manual test.** Block SSE in DevTools, watch polling kick in at 10s.

---

### Phase F — Documentation

#### Task F1: Update `docs/specs/03-resume-tailoring.md` with v2 batch generation

- **path:** `docs/specs/03-resume-tailoring.md` (backend repo)
- **intent:** Spec doc must reflect the v2 surface. Existing v1 batch section is preserved and tagged as legacy. Add new v2 section covering acceptance criteria, endpoints, SSE contract, queue/worker design.
- **verify:** Re-read the section as a new engineer — would I understand the contract end-to-end? Yes.
- **agency:** `Technical Writer`
- **docs:** existing `docs/specs/03-resume-tailoring.md` (read fully first)

Steps:

- [ ] **Step 1: Read the existing file** to understand format conventions and where existing batch content lives.

- [ ] **Step 2: Mark the existing AC-RTL-06 and AC-RTL-07** as `(v1 — legacy)` in their bullet text. Do not delete.

- [ ] **Step 3: Add new acceptance criteria** in the same format:

```markdown
- [ ] **AC-RTL-10 (v2):** `POST /resume-tailoring/batch/v2/generate` returns **HTTP 202** with `{ batchId, totalJobs }` in <500ms. Jobs are enqueued for async processing and are NOT processed inline.
- [ ] **AC-RTL-11 (v2):** v2 batch worker processes jobs in **parallel** with concurrency 3, computing the changes diff inline so per-job results return with accurate `keywordsAdded`, `sectionsChanged`, and `matchScoreBefore`/`matchScoreAfter` populated from the diff (never from LLM self-report).
- [ ] **AC-RTL-12 (v2):** `GET /resume-tailoring/batch/v2/:batchId/events` opens a Server-Sent Events stream that emits `snapshot` (immediate), `job_started`, `job_progress`, `job_completed`, `job_failed`, `batch_completed`, and `heartbeat` events per the contract in §[SSE Contract] below.
- [ ] **AC-RTL-13 (v2):** `GET /resume-tailoring/batch/v2/:batchId/status` returns the same shape as the SSE `snapshot` event for polling-fallback clients.
- [ ] **AC-RTL-14 (v2):** Batch state survives connection drops, tab close, and process restarts via `batch_tailoring_runs` and `batch_tailoring_jobs` tables. Reopening with the same `batchId` returns the current state.
- [ ] **AC-RTL-15 (v2):** v2 batch endpoint enforces the same hard limit of **3 jobs per batch** (`400 Bad Request` on excess) and the same auth/rate-limit policy as v1 (`FeatureType.RESUME_BATCH_GENERATION`).
```

- [ ] **Step 4: Add a new "Batch generation v2 (async + SSE)" section after the existing v1 batch section.** Include:
  - Endpoint table (POST, SSE, status)
  - Lifecycle diagram (copy from §3 of this plan)
  - SSE event contract (copy from §4 of this plan)
  - Database tables (copy from §5 of this plan, brief)
  - "v1 vs v2" comparison table

- [ ] **Step 5: Visual diff** — re-read the entire file to confirm v1 sections are untouched and v2 is additive only.

#### Task F2: Update `docs/API-PATTERNS.md` with SSE pattern

- **path:** `docs/API-PATTERNS.md` (backend repo)
- **intent:** Document the SSE pattern as a reusable building block for future async features.
- **verify:** Section reads as a generic SSE recipe with the v2 batch flow as the worked example.
- **agency:** `Technical Writer`
- **docs:** existing `docs/API-PATTERNS.md`

Steps:

- [ ] **Step 1: Read the existing file** to see how patterns are currently documented (tone, depth, code examples).

- [ ] **Step 2: Add a section** titled "Async long-running operation pattern (queue + SSE)". Cover:
  - When to use it (any operation >5s where the user is blocked waiting)
  - Components (DB persistence, Bull queue, worker, RxJS pub-sub gateway, SSE controller, polling fallback)
  - Event shape conventions (use `snapshot`, granular events, terminal `*_completed` event)
  - Heartbeat (20s recommendation)
  - Last-Event-ID strategy (replay snapshot on reconnect for v1; full event log replay reserved for future)
  - Example endpoints from v2 batch tailoring
  - Anti-patterns (synchronous long-poll, busy-wait, holding HTTP connection >30s)

#### Task F3: Update frontend `docs/CONVENTIONS.md` with SSE consumption pattern

- **path:** `ats-fit-frontend/docs/CONVENTIONS.md`
- **intent:** Document the EventSource + signal pattern so future async features use the same shape.
- **verify:** Section reads as a generic SSE consumer recipe.
- **agency:** `Technical Writer`
- **docs:** existing `ats-fit-frontend/docs/CONVENTIONS.md`

Steps:

- [ ] **Step 1: Read the existing file.**

- [ ] **Step 2: Add a section** titled "Consuming Server-Sent Events". Cover:
  - When to use SSE vs WebSocket vs polling
  - The wrapper service pattern (`*EventsService`) with `connectionStatus` signal
  - State machine pattern (signals-based, applyEvent dispatcher)
  - Polling fallback after N seconds of disconnect
  - Cleanup on `OnDestroy`
  - Example: v2 batch tailoring (`BatchTailoringV2EventsService`, `BatchTailoringV2State`)

---

### Phase G — Verification

#### Task G1: End-to-end smoke test (manual)

- **path:** N/A (verification task)
- **intent:** Validate the full flow with all the edge cases.
- **verify:** All scenarios in the checklist below pass.
- **agency:** `API Tester`
- **docs:** `docs/TESTING-STRATEGY.md`

Steps:

- [ ] **Step 1: Happy path — 3 jobs, all succeed.** API responds <500ms; modal transitions instantly; cards cycle through states; first card completes ~30-40s; all complete by ~50s; Download All ZIP works.

- [ ] **Step 2: Mixed outcome — 1 of 3 fails.** Submit one job with deliberately bad JD (5 chars, fails validation OR upstream). That card shows Failed; others succeed; header shows "2 of 3 complete · 1 failed".

- [ ] **Step 3: SSE drop & reconnect.** Block SSE URL in DevTools. "Reconnecting…" banner appears; browser auto-reconnects; banner clears.

- [ ] **Step 4: Polling fallback.** Permanently block SSE. After 10s, `/status` calls every 2s in DevTools; UI continues updating.

- [ ] **Step 5: Tab close + return.** Submit batch. Close tab. Wait 60s. Reopen app, navigate to `?batchId=...` (or call `/status` via curl). Verify completed state is reachable.

- [ ] **Step 6: Validation.** 4 jobs → 400. 0 jobs → 400. JD < 20 chars → 400.

- [ ] **Step 7: Database invariants.** After successful batch:
  - 1 row in `batch_tailoring_runs` with `status='completed'`, `completed_jobs=N`
  - N rows in `batch_tailoring_jobs`, all `state='completed'` with valid `resume_generation_id`
  - N rows in `resume_generations` with `changes_diff` populated

- [ ] **Step 8: v1 still works.** Hit `POST /resume-tailoring/batch-generate` (v1) directly with curl. Verify it still returns synchronously with the same shape it always did. (v1 frontend usage is no longer the default but the backend route stays.)

#### Task G2: Performance benchmark

- **path:** N/A
- **intent:** Quantify the latency improvement.
- **verify:** Numbers documented in PR description.
- **agency:** `Performance Benchmarker`
- **docs:** `docs/TESTING-STRATEGY.md`

Steps:

- [ ] **Step 1: Baseline (v1).** Submit 2-job batch via `POST /resume-tailoring/batch-generate`. Time submit → response. Expect ~90s.

- [ ] **Step 2: v2.** Submit 2-job batch via `POST /resume-tailoring/batch/v2/generate`. Time:
  - API response time (target: <500ms)
  - First job complete time (target: 30-40s)
  - Full batch complete time (target: 45-55s)

- [ ] **Step 3: Document in PR description**:

```markdown
## Performance comparison (2-job batch)

| Metric | v1 (sequential) | v2 (async + SSE) |
|---|---|---|
| API response | ~90s | ~300ms |
| First result visible | ~90s | ~35s |
| All results visible | ~90s | ~50s |
| User can close tab | no | yes |
| Single source of truth (diff) | no (LLM self-report) | yes (computed) |
```

#### Task G3: Code review

- **path:** N/A
- **intent:** Independent reviewer audits correctness, security, and maintainability.
- **verify:** Reviewer's report attached to PR; all blocking comments resolved.
- **agency:** `Code Reviewer`
- **docs:** `docs/SECURITY.md`, `docs/CONVENTIONS.md`, `docs/ERROR-HANDLING.md`

Steps:

- [ ] **Step 1: Reviewer audits**:
  - Tenant isolation: every DB query in `BatchTailoringV2Service` filters by `userId`
  - SSE endpoint requires JWT (via guard or query-token); no batch is leakable to non-owner
  - Bull job retry config (`attempts: 2`) is sane
  - No secrets in logs
  - Error messages don't leak internal paths
  - SSE event payloads scoped to owner only
  - v1 endpoint untouched (route + handler diff is empty)

- [ ] **Step 2: Address findings.**

- [ ] **Step 3: Approve.**

---

## 8. Self-review

**Working agreements check:**
- ✅ No `git commit` step in any task
- ✅ v1 endpoint route + handler explicitly preserved (called out in §6 "Explicitly NOT modified" lists, and Task G1 step 8 verifies)
- ✅ v2 namespace consistently applied (queue name, file paths, controller route, services, state)
- ✅ Spec doc update task (F1) included; API patterns (F2) and frontend conventions (F3) updated

**Spec coverage check** (re-read §1–4 vs. tasks):
- §1.1 API <500ms → C2
- §1.2 Parallel processing via Bull → B3 (concurrency=3)
- §1.3 SSE streaming → C3
- §1.4 Diff inline (single source of truth) → B0
- §1.5 Persistent batch state → A1-A3 + C1
- §3 Architecture diagram → backend covered A1-C4, frontend covered D1-E4
- §4 SSE event contract → all events emitted by B3, consumed by D2/D4
- §5 DB schema → A1
- §6 File structure → all created files listed in tasks; v1 preservation explicit

**Placeholder scan**: no TBDs, every code block complete, every task has agency + docs + verify.

**Type consistency check**:
- `BatchJobState` defined in entity (A3), used in interfaces (B1), state machine (D4), components (E1) — same string union throughout.
- `SnapshotEvent` defined in B1, returned by `BatchTailoringV2Service.getSnapshot` in C1 and SSE controller in C3 — consistent.
- `BatchJobPayloadV2` defined in B1, consumed in B3 and produced in C1 — consistent.
- `BATCH_TAILORING_V2_QUEUE` defined once in B1, referenced in B3 (`@Processor`), B4 (`BullModule.registerQueue`), C1 (`@InjectQueue`) — single source.

**No unaddressed issues found.**

---

## 9. Execution handoff

Plan saved to `ats-fit-backend/docs/superpowers/plans/2026-05-07-batch-resume-tailoring-async-pipeline.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh Agency specialist subagent per task using the `agency` field. Two-stage review between tasks. Best for high-quality execution.

**2. Inline Execution** — Use `superpowers:executing-plans` to batch-execute tasks in this session with checkpoints. Faster iteration, less independent review per task.

Which approach do you want?
