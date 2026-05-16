---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Resume tailoring

## Business intent

Turn a **job description + candidate context** into a **downloadable tailored resume** (and optional cover letter), with **history** and **diff** so users trust the output and can reuse past runs.

## Traceability

| ID | Kind |
|----|------|
| REQ-004, REQ-005 | Functional |
| REQ-009 | Functional (limits on generate / batch / cover letter) |

## Acceptance criteria

- [ ] **AC-RTL-01:** User can list resume templates from the public templates endpoint.
- [ ] **AC-RTL-02:** User can request a tailored resume and receive a **PDF** with **generation id** and key metrics exposed per response headers (see controller).
- [ ] **AC-RTL-03:** Generate endpoint respects **rate limits** for resume generation (`FeatureType.RESUME_GENERATION`).
- [ ] **AC-RTL-04:** Authenticated user can list generation history, fetch one generation, download PDF, and fetch diff for **their own** generations only.
- [ ] **AC-RTL-05:** Cover letter endpoint accepts either `resumeGenerationId` or full job fields; enforced rate limit type `COVER_LETTER`.
- [ ] **AC-RTL-06 (v1 — legacy):** Batch endpoint processes jobs **sequentially** and returns per-job success/failure without failing the entire batch on one error.
- [ ] **AC-RTL-07 (v1 — legacy):** Batch endpoint rejects requests with more than **3 jobs** with `400 Bad Request` and descriptive error message.
- [ ] **AC-RTL-08:** The diff endpoint (`GET /resume-tailoring/diff/:generationId`) is shared across single and batch generation — any `resumeGenerationId` from either flow can be passed.
- [ ] **AC-RTL-09:** The frontend exposes a full AI change-comparison view ("See what changed") for **both** single and batch tailored resumes, using the same `ResumeComparisonComponent`.
- [ ] **AC-RTL-10 (v2):** `POST /resume-tailoring/batch/v2/generate` returns **HTTP 202** with `{ batchId, totalJobs }` in <500ms. Jobs are enqueued for async processing and NOT processed inline.
- [ ] **AC-RTL-11 (v2):** v2 batch worker processes jobs in **parallel** with concurrency 3, computing the changes diff inline so per-job results return with accurate `keywordsAdded`, `sectionsChanged`, and `matchScoreBefore`/`matchScoreAfter` populated from the diff (not from LLM self-report).
- [ ] **AC-RTL-12 (v2):** `GET /resume-tailoring/batch/v2/:batchId/events` opens a Server-Sent Events stream that emits `snapshot` (immediate), `job_started`, `job_progress`, `job_completed`, `job_failed`, `batch_completed`, and `heartbeat` events.
- [ ] **AC-RTL-13 (v2):** `GET /resume-tailoring/batch/v2/:batchId/status` returns the same shape as the SSE `snapshot` event for polling-fallback clients.
- [ ] **AC-RTL-14 (v2):** Batch state survives connection drops, tab close, and server restarts via `batch_tailoring_runs` and `batch_tailoring_jobs` tables.
- [ ] **AC-RTL-15 (v2):** v2 batch endpoint enforces a hard limit of **3 jobs per batch** (400 Bad Request on excess) and uses the same JWT auth policy as v1.
- [ ] **AC-RTL-16:** Resume history detail panel exposes a "See full changes" button that opens the full `ResumeComparisonComponent` in-place (no page navigation), consistent with the post-generation flow.

## Templates

- **`GET /resume-tailoring/templates`** — List available resume templates (**public**).

## Generate tailored resume (single)

- **`POST /resume-tailoring/generate`** — **Public** (no JWT required) but subject to **rate limits** (`FeatureType.RESUME_GENERATION`).
- **Multipart:** `resumeFile` (PDF) optional when resume already stored; body fields include job description, position, company, `templateId`, optional `resumeId` (see `GenerateTailoredResumeDto` in code).
- **Response:** Raw **PDF** stream (not JSON) — unless the pre-generation relevance gate fires (see below).
- **Response headers (client contract):** Include generation id, tailoring mode, keyword/section/achievement metrics, and optimization confidence (see controller `setPdfResponseHeaders` in code for exact header names). Also includes `X-Relevance-Score`, `X-Relevance-Verdict`, `X-Relevance-Cache-Hit` on PDF responses.

### Pre-generation relevance gate

When `JOB_RELEVANCE_GATE_ENABLED=true`, `POST /resume-tailoring/generate` runs a Haiku 4.5 job-fit check **in parallel** with the tailoring pipeline. If the score verdict is `low` and `acknowledgeLowFit` was not `true`, the tailoring pipeline is aborted and the response is:

- **HTTP 200** with `Content-Type: application/json`
- Body: `{ "type": "low_fit_warning", "relevance": { score, verdict, dimensions, gaps, strengths, ... } }`

To force generation regardless of score, resubmit with `acknowledgeLowFit: true`. The relevance result is persisted on the `resume_generations.pre_generation_relevance` column in all cases.

The same pre-flight logic applies to `POST /resume-tailoring/batch/v2/generate`: all jobs are scored synchronously before enqueueing. Any low-fit job returns:

- **HTTP 200** with `{ "type": "batch_low_fit_warning", "jobs": [...per-job verdicts] }`

Set `acknowledgeLowFit: true` in the batch body to bypass the gate.

Kill-switch: set `JOB_RELEVANCE_GATE_ENABLED=false` to disable globally (engine returns `skipped`, score=100, no LLM call fires).

## History and artifacts

- **`GET /resume-tailoring/history`** — Authenticated; optional pagination query params (`page`, `limit`, `search`, `sortOrder`). Without `page`, returns non-paginated list with `limit`.
- **`GET /resume-tailoring/history/:generationId`** — Single generation detail for the current user.
- **`GET /resume-tailoring/download/:generationId`** — PDF download for owned generation.
- **`GET /resume-tailoring/diff/:generationId`** — JSON `{ changesDiff }` for AI-produced before/after diff (authenticated, owner). Shared by single and batch flows — any generation id works.

## Cover letter

- **`POST /resume-tailoring/cover-letter`** — Authenticated; rate limit `FeatureType.COVER_LETTER`.
- **Either** `resumeGenerationId` **or** (`jobPosition`, `companyName`, `jobDescription`) required.

## Batch generation

- **`POST /resume-tailoring/batch-generate`** — Authenticated; rate limit `FeatureType.RESUME_BATCH_GENERATION` (premium-oriented).
- **Body:** shared `templateId` / `resumeId`, array `jobs` with per-job description fields.
- **Constraint:** Maximum **3 jobs** per batch request (hard limit; requests exceeding this return `400 Bad Request`).
- **Behavior:** Processes jobs **sequentially** in one request; each item succeeds or fails independently; response includes `batchId`, `results[]`, and `summary` (counts, timing).
- **Processing time:** Generating **3 resumes** takes approximately **2 minutes**.

## Batch Generation v2 (Async + SSE)

> v1 (`POST /resume-tailoring/batch-generate`) is preserved and unchanged. v2 is the new default for the frontend.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/resume-tailoring/batch/v2/generate` | Enqueue batch (returns 202 immediately) |
| GET | `/resume-tailoring/batch/v2/:batchId/events` | SSE stream of live progress events |
| GET | `/resume-tailoring/batch/v2/:batchId/status` | Polling fallback — current snapshot |

### Request body (`POST generate`)

```json
{
  "jobs": [
    { "jobPosition": "SWE", "companyName": "Acme", "jobDescription": "..." }
  ],
  "templateId": "uuid",
  "resumeId": "uuid (optional)"
}
```

### SSE Event Contract

All events are JSON-encoded on the `data:` line.

| Event | Data shape |
|-------|-----------|
| `snapshot` | `{ batchId, totalJobs, status, jobs[] }` |
| `job_started` | `{ batchId, jobIndex, stage: 'analyzing' }` |
| `job_progress` | `{ batchId, jobIndex, stage: 'optimizing' \| 'finalizing' }` |
| `job_completed` | `{ batchId, jobIndex, result: BatchJobResult }` |
| `job_failed` | `{ batchId, jobIndex, error: string }` |
| `batch_completed` | `{ batchId, summary: { total, succeeded, failed, totalProcessingTimeMs } }` |
| `heartbeat` | `{ ts: number }` (every 20s) |

### Database tables

- `batch_tailoring_runs` — one row per batch (`id`, `user_id`, `total_jobs`, `status`, `last_event_id`, ...)
- `batch_tailoring_jobs` — one row per job (`batch_id` FK, `job_index`, `state`, `resume_generation_id` FK, ...)

### v1 vs v2 comparison

| | v1 (legacy) | v2 (current) |
|--|-------------|--------------|
| Response | Synchronous (~90s) | 202 Accepted (<500ms) |
| Parallelism | Sequential | Concurrent (max 3) |
| Progress | None (blank spinner) | Per-job SSE events |
| Diff | Async queue (may be null) | Inline in worker |
| Resilience | None | DB-persisted, reconnect-safe |

## Orchestration (conceptual)

Single and batch generation go through an **orchestrator** that coordinates extraction sources, AI optimization, PDF build, and persistence of generation records. Exact steps and prompts: **see code** (`resume-generation-orchestrator.service` and related services).

## Related specs

- Upload and extraction: [04-profile-enrichment.md](./04-profile-enrichment.md)
- Limits: [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
