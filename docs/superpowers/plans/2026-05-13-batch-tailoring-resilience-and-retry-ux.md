# Batch Tailoring Resilience + Retry UX — Implementation Plan

> **For agentic workers:** every task MUST be dispatched via `Agent()` with the `subagent_type` from its `agency` field. Never execute inline. No unit tests (user opted out). No commits per task — user commits at end after review.

**Goal:** Stop batch tailoring from silently failing 1-of-N jobs when Claude truncates the optimizer's tool-use output, and when a job does fail give the user (a) a clear, category-specific message, and (b) a real per-job retry that doesn't re-run the whole batch or burn quota.

**Root cause (confirmed via live Railway logs for batches `0d4a9e95…` and `52546877…`):** Claude's tool-use response for a 9-experience source resume occasionally returns only 4 experiences. `ResumeOptimizerService.validateNoExperienceDropped` correctly catches the truncation and throws `ERR_AI_RESPONSE_PARSING_FAILED`. The optimizer has zero retry, the OpenAI fallback only fires on 529 overload (not on validation failure), and the user is left looking at a generic "internal error" line with no actionable retry. See `docs/superpowers/findings/2026-05-13-batch-1-of-3-fails.md` (investigation summary embedded in this plan's "Why each layer" notes below — no separate file is required).

**Architecture decisions (locked in this plan):**

1. **Telemetry-first.** Before changing behavior, instrument the Claude call so we can prove `max_tokens` truncation is the failure mode. Layer 1 ships first and gives us evidence to confirm/refute the rest.
2. **Bump output budget, don't change model.** `MAX_TOKENS_OPTIMIZATION` 8000 → 12000. User explicitly excluded the Opus 4.7 upgrade — we make the existing model less constrained instead.
3. **Two-tier retry inside the optimizer.** On `ERR_AI_RESPONSE_PARSING_FAILED` (and only that error code — never wrap a `BadRequestException` or a quota error in retry): (a) retry Claude once with a fresh call (cache bypassed), (b) if that also fails the validation guard, fall through to the existing OpenAI fallback. Total upper bound: 3 model calls per optimize attempt (Claude → Claude retry → OpenAI). Each is logged with `attempt` + `outcome` so we can monitor cost.
4. **Typed error envelope persisted on the job row.** `batch_tailoring_jobs.error_message` currently holds a generic user-facing string. Replace with a JSON envelope `{ category, userMessage, technicalDetail, retryable, occurredAt }`. Five categories: `AI_TRUNCATION`, `AI_OVERLOAD`, `AI_PARSING`, `NETWORK`, `UNKNOWN`. The column stays `text` — we just JSON-encode. Migration-free.
5. **Per-job retry endpoint, not whole-batch.** New `POST /api/v1/resume-tailoring/batch/v2/:batchId/jobs/:jobId/retry`. Re-enqueues the single failed job, doesn't decrement quota (quota was consumed at batch enqueue time), emits the same SSE event stream so the FE row updates in place. Hard guardrail: only retryable from state `failed`, only by the batch owner, max 2 manual retries per job (DB column `retry_count` — see Task E for the column add).
6. **FE renders category, not stack.** The error row in `step-results.component.html` reads `errorCategory` + `userMessage` from the BE envelope and renders a category-specific headline + the userMessage as the subline + a single primary "Retry this resume" button on retryable rows. No generic "contact support" copy unless `category === 'UNKNOWN'`.

**Out of scope:**
- Backfilling old `error_message` rows to the new JSON shape — they remain plain strings; the FE parser tolerates both.
- Opus 4.7 model swap — explicitly excluded.
- Unit tests — user opted out for this pass.
- Bumping retry count beyond manual 2 — auto-retry is one machine retry + one OpenAI fallback; further retries are user-initiated only.

---

## Canonical error envelope (single source of truth)

```ts
// src/modules/resume-tailoring/interfaces/batch-job-error.interface.ts
export type BatchJobErrorCategory =
  | 'AI_TRUNCATION'   // LLM returned partial output; validation caught it
  | 'AI_OVERLOAD'     // 529 or sustained rate-limit from provider
  | 'AI_PARSING'      // Could not parse LLM JSON / tool_use payload
  | 'NETWORK'         // 5xx, socket hangup, DNS, etc. from provider
  | 'UNKNOWN';        // Catch-all — always retryable from the FE

export interface BatchJobError {
  category: BatchJobErrorCategory;
  userMessage: string;       // Ready-to-display headline + advice
  technicalDetail: string;   // ERR_* code + short reason — logged, not shown
  retryable: boolean;        // Always true except for hard quota / auth errors
  occurredAt: string;        // ISO timestamp
}
```

Category → userMessage rules (locked in classifier):

| Category | Headline | Subline |
|---|---|---|
| `AI_TRUNCATION` | "This resume needs a longer answer than the AI returned." | "We'll try again with more room. Tap retry to give it another shot." |
| `AI_OVERLOAD` | "The AI service was busy. We backed off to be polite." | "Tap retry — capacity usually recovers within a few seconds." |
| `AI_PARSING` | "The AI returned a response we couldn't read cleanly." | "This is rare. Retry usually succeeds on the second pass." |
| `NETWORK` | "We couldn't reach the AI service." | "Check your connection and tap retry, or try again in a moment." |
| `UNKNOWN` | "Something unexpected happened generating this resume." | "Tap retry. If this keeps happening, let us know — we'll dig in." |

`retryable: false` only when the underlying error is a `BadRequestException` (bad input — the user has to fix the JD/resume, not retry) or `ForbiddenException` (auth/quota). In those cases the FE renders the message without a retry button.

---

## Task A — Claude telemetry (Layer 1, ships first)

**path:**
- `src/shared/modules/external/services/claude.service.ts` (MODIFY: in the `chatCompletion` method, after the SDK response resolves, log a single structured line: `Claude completion {promptId} v{promptVersion} attempt={attempt ?? 1} stop_reason={response.stop_reason} input_tokens={response.usage.input_tokens} output_tokens={response.usage.output_tokens} cache_read={response.usage.cache_read_input_tokens ?? 0} cache_create={response.usage.cache_creation_input_tokens ?? 0} duration_ms={Date.now() - startedAt}`. Add `startedAt` capture before the API call. Use `this.logger.log()` at INFO so it shows in prod.)
- `src/modules/resume-tailoring/services/resume-optimizer.service.ts` (MODIFY: when calling `claudeService.chatCompletion` from `optimizeWithClaude` / `optimizeWithClaudeRubric`, pass an additional opaque `attempt` param through the `chatCompletion` arg surface so the log line above can include it. Default `1` until Task C lands; Task C will pass `2` on the retry call.)

**intent:**
Make Claude's `stop_reason` and token counts observable in prod logs. Without this we are guessing whether `max_tokens` truncation is the actual failure mode. After this lands, re-run a 9-experience batch and confirm the failed call's log line shows `stop_reason: 'max_tokens'` (truncation) vs `'end_turn'` (model voluntarily wrapped up — different bug class).

**verify:**
- `cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run build` exits 0
- `npm run lint` exits 0
- Manual: trigger one single-resume tailoring locally; tail logs and confirm a line like `Claude completion resume-optimization:control v2.3 attempt=1 stop_reason=end_turn input_tokens=4203 output_tokens=5821 duration_ms=18420` appears.
- Manual on prod: after deploy, re-trigger Muhammad Saeed's 3-batch flow; on the failed call confirm whether `stop_reason` is `max_tokens` (locks in Layer 2 as the right fix) or `end_turn` (means model is non-compliant despite headroom — Layer 3 retry is the load-bearing fix).

**agency:** `Backend Architect`

**docs:**
- `.ai/CONTRACT.md`
- `docs/CONVENTIONS.md`
- `docs/ARCHITECTURE.md`
- Existing `feedback_dispatch_specialists.md` memory

---

## Task B — Bump optimizer `max_tokens` (Layer 2)

**path:**
- `src/shared/constants/resume-tailoring.constants.ts` (MODIFY: `MAX_TOKENS_OPTIMIZATION` 8000 → 12000. Recompute the `MAX_TOKENS_OPTIMIZATION_WITH_THINKING` derived constant accordingly — it's `MAX_TOKENS_OPTIMIZATION + EXTENDED_THINKING_BUDGET_TOKENS`, so it goes from 12000 → 16000 automatically.)

**intent:**
Eliminate `max_tokens` as a truncation cause for 8–12-experience resumes. Empirically a 9-experience tailored resume in our `return_optimized_resume` tool JSON is ~6000–7500 output tokens; 8000 leaves no slack and Claude occasionally clips. 12000 gives ~50% headroom which covers all observed sizes.

**verify:**
- `npm run build && npm run lint` both exit 0
- Manual: after Task A is also deployed, re-run Saeed's 3-batch flow. Inspect the Claude log line — `output_tokens` for the previously-failing call should land somewhere in 6000–9000 and `stop_reason: end_turn`. The job should succeed.
- Cost sanity: 12000-token Claude completions cost ~50% more per call than 8000-token ones. Acceptable trade — failures cost a retry + an OpenAI fallback today.

**agency:** `Backend Architect`

**docs:**
- `.ai/CONTRACT.md`
- `docs/CONVENTIONS.md`

---

## Task C — Two-tier retry inside the optimizer (Layers 3 + 4)

**path:**
- `src/modules/resume-tailoring/services/resume-optimizer.service.ts` (MODIFY: extract the "call Claude → scrub → restore skills → validate" block (lines ~215–263 today) into a private async helper `runOptimizationAttempt(...)`. Wrap the call from `optimizeResumeContent` in a retry-once loop: (1) call `runOptimizationAttempt` with `attempt=1`; (2) catch ONLY errors whose `errorCode === ERROR_CODES.AI_RESPONSE_PARSING_FAILED` — for any other error code, rethrow immediately; (3) on catch, log a structured `Optimizer retry attempt=2 reason=parsing-validation-failed previous_output_count={N}` line and call `runOptimizationAttempt` again with `attempt=2`. Important: bypass the optimization cache on `attempt=2` by passing a `skipCache: true` flag down to `optimizeWithClaude` so the second attempt doesn't return the cached failure. (4) if attempt 2 also fails the validation guard, log `Falling through to OpenAI fallback after 2 Claude attempts failed validation` and call the existing `optimizeWithOpenAI` helper. Wrap THAT in a try/catch — if OpenAI also fails validation, throw the original `AI_RESPONSE_PARSING_FAILED` exception (the user-facing error envelope built in Task D will then categorize it as `AI_TRUNCATION`).)
- `src/modules/resume-tailoring/services/resume-optimizer.service.ts` (MODIFY: the existing OpenAI fallback inside `optimizeResumeContent` is currently a "catch 529 overload" path — leave that intact. The new fallthrough added above is a separate code path triggered by parsing/validation failure, not by an Anthropic error. Both call `optimizeWithOpenAI` — that's fine, the helper is idempotent.)
- `src/modules/resume-tailoring/services/resume-optimizer.service.ts` (MODIFY: thread an `attempt: number` arg through `optimizeWithClaude` and `optimizeWithClaudeRubric` so Task A's log line distinguishes first vs second attempts in prod logs.)

**intent:**
When Claude returns truncated output, give it one fresh shot (cache-bypassed), and if that also truncates, fall to OpenAI. After this lands, the user-visible failure rate for parsing/validation drops to near-zero (we'd need both Claude calls and OpenAI to all truncate the same resume in the same minute — improbable). Total worst-case latency goes from ~30s to ~90s for the unlucky 1-in-3 case, but the job succeeds where it would have failed.

**Critical sub-requirements:**
- Retry MUST bypass the optimization cache on attempt 2. If we don't, the cached parse-fail result is returned and we loop forever / give up immediately. Find the `this.cacheService.get(...)` lookup near the top of `optimizeResumeContent` and short-circuit it when an internal `_skipCache` flag is set, OR move the cache lookup outside the retry helper entirely — whichever keeps the diff smallest.
- The retry helper MUST NOT retry on `BadRequestException` (user input is bad — retry won't help), `ForbiddenException` (quota/auth), or any error code that isn't `AI_RESPONSE_PARSING_FAILED`. Whitelist, not blacklist.
- Total LLM calls per `optimizeResumeContent` invocation MUST be observable. Log the final outcome as `Optimizer final outcome attempt={1|2|openai-fallback} duration_ms={total}`.
- The OpenAI fallback path also runs through `validateNoExperienceDropped`. If OpenAI also drops experiences, we have to surface the failure — don't swallow it. Throw the original `AI_RESPONSE_PARSING_FAILED` so Task D's classifier maps it to `AI_TRUNCATION` and Task F's FE shows a retryable error.

**verify:**
- `npm run build && npm run lint` both exit 0
- Manual on prod: re-run Saeed's 3-batch flow at least 5 times. Expected: 0 failures across 15 jobs. If any job still fails, inspect Task A's log line for that call — must show `attempt=openai-fallback` with `stop_reason='length' | 'content_filter' | ...` to prove all 3 layers ran. If we see attempt=1 fail without an attempt=2 log line, the retry didn't fire — bug in the catch logic.
- Cost sanity: monitor for one week. If the retry rate exceeds 10% of optimizer calls, Layer 2 wasn't enough and we need to revisit `max_tokens`.

**agency:** `Backend Architect`

**docs:**
- `.ai/CONTRACT.md`
- `docs/ARCHITECTURE.md`
- `docs/CONVENTIONS.md`

---

## Task D — Typed error envelope on `batch_tailoring_jobs.error_message`

**path:**
- `src/modules/resume-tailoring/interfaces/batch-job-error.interface.ts` (NEW: exports `BatchJobError` interface + `BatchJobErrorCategory` union — content per the "Canonical error envelope" section above)
- `src/modules/resume-tailoring/services/batch-job-error-classifier.service.ts` (NEW: `@Injectable()` with a single method `classify(error: unknown): BatchJobError`. Pattern-matches on (a) `error.errorCode === ERROR_CODES.AI_RESPONSE_PARSING_FAILED` → `AI_TRUNCATION` (the validateNoExperienceDropped path); (b) `error.errorCode === ERROR_CODES.AI_RESPONSE_PARSING_FAILED` && message includes 'parse' → `AI_PARSING` — actually distinguish via a new sub-code rather than message substring; add `ERROR_CODES.AI_OUTPUT_TRUNCATED` as a distinct code from `AI_RESPONSE_PARSING_FAILED` and have `validateNoExperienceDropped` throw the new one; (c) Anthropic 529 / OpenAI rate_limit → `AI_OVERLOAD`; (d) `error instanceof BadRequestException` → `UNKNOWN` with `retryable: false`; (e) anything with `code === 'ECONNRESET'`, `'ETIMEDOUT'`, `'ENOTFOUND'`, or HTTP 5xx → `NETWORK`; (f) default → `UNKNOWN`. The classifier owns the headline/subline table from the "Canonical" section above.)
- `src/shared/constants/error-codes.constants.ts` (MODIFY: add `AI_OUTPUT_TRUNCATED = 'ERR_AI_OUTPUT_TRUNCATED'`. Keep `AI_RESPONSE_PARSING_FAILED` as the parse-failure code; truncation gets its own code so the classifier and the retry logic can distinguish.)
- `src/modules/resume-tailoring/services/resume-optimizer.service.ts` (MODIFY: change `validateNoExperienceDropped`'s thrown error to use `ERROR_CODES.AI_OUTPUT_TRUNCATED` instead of `AI_RESPONSE_PARSING_FAILED`. Update Task C's retry-loop whitelist accordingly — it now retries on BOTH `AI_OUTPUT_TRUNCATED` AND `AI_RESPONSE_PARSING_FAILED`.)
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.processor.ts` (MODIFY: in the catch block that currently writes a generic user-facing string to `error_message`, instead call `errorClassifier.classify(error)` and persist `JSON.stringify(envelope)` to the column. Bonus: log the `technicalDetail` field separately so logs still show the raw cause.)
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.module.ts` (MODIFY: register `BatchJobErrorClassifierService` as a provider)
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts` (MODIFY: where batch job results are shaped for API responses — find the mapper that converts `BatchTailoringJob` entities to the API DTO — parse the JSON envelope from `error_message` if it starts with `{`, fall back to a synthesized `BatchJobError` (`category: 'UNKNOWN', retryable: true, userMessage: <the legacy string>`) if it's a plain string. Both shapes coexist; the FE always reads the parsed shape.)

**intent:**
Store an error category + user-facing message on every failed job so the FE can render specific, helpful copy and decide whether to show a retry button. Legacy rows with plain-string `error_message` still render correctly (mapped to `UNKNOWN, retryable: true`).

**Critical sub-requirements:**
- The envelope is JSON-encoded into the existing `text` column — NO migration. The mapper detects shape at read time.
- The classifier MUST NOT throw. If it can't categorize, return `UNKNOWN`. Failure modes inside error-handling are how we get blank screens.
- `retryable: false` is rare — only true `BadRequestException` and `ForbiddenException`. Everything else gets the retry button.

**verify:**
- `npm run build && npm run lint` both exit 0
- Manual: force a fresh batch failure (e.g. temporarily make `validateNoExperienceDropped` always throw). Query `SELECT error_message FROM batch_tailoring_jobs WHERE state = 'failed' ORDER BY completed_at DESC LIMIT 1;` — must be a parseable JSON envelope with `category: 'AI_TRUNCATION'`.
- Manual: query a legacy failed row (from the May-12 batches `0d4a9e95…` / `52546877…`). Confirm the FE-side parser falls back to `UNKNOWN/retryable: true` without crashing.

**agency:** `Backend Architect`

**docs:**
- `.ai/CONTRACT.md`
- `docs/API-PATTERNS.md`
- `docs/ARCHITECTURE.md`

---

## Task E — Per-job retry endpoint

**path:**
- `src/database/migrations/<timestamp>-add-retry-count-to-batch-jobs.ts` (NEW: TypeORM migration that adds `retry_count INTEGER NOT NULL DEFAULT 0` to `batch_tailoring_jobs`. Generate timestamp via `Date.now()`. Reversible — down migration drops the column.)
- `src/database/entities/batch-tailoring-job.entity.ts` (MODIFY: add `@Column({ name: 'retry_count', type: 'int', default: 0 }) retry_count: number;`)
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.controller.ts` (MODIFY: add `@Post(':batchId/jobs/:jobId/retry') @UseGuards(AuthGuard) async retryJob(@Param('batchId') batchId: string, @Param('jobId') jobId: string, @Req() req): Promise<RetryJobResponse>`. Delegates to a new service method.)
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts` (MODIFY: add `retryFailedJob(batchId: string, jobId: string, userId: string): Promise<{ ok: true }>`. Guards: (1) load the batch — 404 if not found, 403 if `batch.user_id !== userId`; (2) load the job by `id` AND `batch_id = batchId` — 404 otherwise; (3) reject with 409 `JOB_NOT_RETRYABLE` if `job.state !== 'failed'`; (4) reject with 429 `RETRY_LIMIT_EXCEEDED` if `job.retry_count >= 2`; (5) update the job row: `state = 'queued'`, `error_message = null`, `started_at = null`, `completed_at = null`, `retry_count = retry_count + 1`, `resume_generation_id = null`. Then call `processor.handle({ jobId, batchId, ... })` exactly as the original enqueue path does — reuse the existing `processor.handle` entry point, do NOT duplicate orchestration logic. Do NOT decrement quota — quota was already consumed at batch enqueue time.)
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.processor.ts` (MODIFY: ensure the existing `handle` entry point is callable from outside the queue worker — i.e. exposed as a public method that takes the same payload shape the queue normally feeds it. If it's already public, no change.)
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2-events.gateway.ts` (MODIFY: the existing SSE channel for `batch:{batchId}` should naturally pick up the new `job_started → job_progress → job_completed | job_failed` events for the retried job since the processor emits them. Verify by reading the publish call sites — if any of them filter on a `firstAttempt` flag, remove the filter so retries also emit.)
- `src/modules/resume-tailoring/dtos/batch-job-retry.dto.ts` (NEW: simple response DTO `{ ok: true; jobId: string; retryCount: number }`)
- `src/shared/constants/error-codes.constants.ts` (MODIFY: add `JOB_NOT_RETRYABLE = 'ERR_JOB_NOT_RETRYABLE'`, `RETRY_LIMIT_EXCEEDED = 'ERR_RETRY_LIMIT_EXCEEDED'`.)

**intent:**
Give the FE a single endpoint to retry one failed job in place, without re-running the whole batch and without consuming additional quota. The retry path runs through the same processor as the original — meaning Task C's two-tier retry, Task D's error envelope, and Task A's telemetry all apply. Hard limit: 2 manual retries per job (prevents infinite-loop spam from the FE).

**Critical sub-requirements:**
- Ownership check is non-negotiable — a user MUST NOT be able to retry another user's job. Mirror the same guard pattern used by `getBatchStatus` / similar endpoints.
- The retry MUST emit SSE events on the existing batch channel so the FE row updates in place. If the gateway has any "first attempt only" guard, drop it.
- The `retry_count` column is for safety (cap at 2) and for analytics. Don't lower the cap to 1 — users legitimately want a second manual retry after a first failed retry.
- Quota: do NOT call any quota-consumption helper. Quota was paid at batch enqueue.
- If the retry ALSO fails, the new error envelope replaces the old one (which is the desired behavior — the FE re-renders with the latest cause).

**verify:**
- `npm run build && npm run lint` both exit 0
- Manual: pick a failed job from the May-12 batches. POST to `/api/v1/resume-tailoring/batch/v2/0d4a9e95-4f11-4425-be2b-ad823527a22c/jobs/03daae52-08ff-4eba-9da7-7f2342bf6a0c/retry` with the user's token. Expected: 200 with `{ ok: true, jobId: '03daae52…', retryCount: 1 }`. Watch the SSE stream — `job_started` then `job_completed` (or `job_failed` with a fresh envelope) should fire.
- Manual: hit the same endpoint a third time (after two retries). Expected: 429 with code `ERR_RETRY_LIMIT_EXCEEDED`.
- Manual: hit it from a different user's token. Expected: 403.
- Manual: hit it on a job whose state is `completed`. Expected: 409 with code `ERR_JOB_NOT_RETRYABLE`.

**agency:** `Backend Architect`

**docs:**
- `.ai/CONTRACT.md`
- `docs/API-PATTERNS.md`
- `docs/CONVENTIONS.md`
- `docs/ARCHITECTURE.md`

---

## Task F — FE: category-aware error UI + per-job retry button

**path:**
- `src/app/features/tailor-apply/models/batch-tailoring.model.ts` (MODIFY: add `BatchJobErrorCategory` union + `BatchJobError` interface mirroring the BE shape; add optional `error?: BatchJobError` and `retryCount?: number` to `BatchJobResult`. Keep the legacy plain-string `errorMessage` field for backwards-compat with mid-deploy responses.)
- `src/app/shared/services/resume.service.ts` (MODIFY: in the batch-result mapper, parse `error_message` — if it starts with `{` and JSON.parse succeeds, use the parsed `BatchJobError`; otherwise synthesize `{ category: 'UNKNOWN', userMessage: <the plain string>, retryable: true, technicalDetail: '', occurredAt: '' }`. Both shapes flow into `BatchJobResult.error`.)
- `src/app/shared/services/resume.service.ts` (MODIFY: add `retryBatchJob(batchId: string, jobId: string): Observable<{ ok: true; jobId: string; retryCount: number }>` that POSTs to the new BE endpoint. On success, emit no state change — the SSE channel will deliver the actual job-state transitions. On 429 (`ERR_RETRY_LIMIT_EXCEEDED`), surface a toast "You've reached the retry limit for this resume — try a new batch.")
- `src/app/features/tailor-apply/components/step-results/step-results.component.html` (MODIFY: replace the current failed-row block with a presentation that reads `result.error.userMessage` as the headline and conditionally shows a "Retry this resume" button when `result.error.retryable` is true. Wire the button to call a new component method `onRetry(result)`.)
- `src/app/features/tailor-apply/components/step-results/step-results.component.ts` (MODIFY: add `onRetry(result: BatchJobResult): void` that disables the button (per-row signal `retryingJobIds = signal<Set<string>>(new Set())`), calls `resumeService.retryBatchJob(batchId, result.jobId)`, and on response toggles the button back off. Don't manually update the row state — SSE handler does that.)
- `src/app/features/tailor-apply/components/batch-job-card/batch-job-card.component.html` + `.ts` (MODIFY: same treatment for the per-job card surface that shows during batch progress — display the category headline + retry button when `result.error` exists and is retryable.)
- `src/app/features/tailor-apply/components/batch-results/batch-results.component.html` + `.ts` (MODIFY: same treatment for the consolidated batch-results view.)
- `src/app/core/constants/api.constant.ts` (MODIFY: add the new endpoint path constant, e.g. `BATCH_V2_RETRY_JOB: (batchId, jobId) => '/api/v1/resume-tailoring/batch/v2/' + batchId + '/jobs/' + jobId + '/retry'`)

**intent:**
The user opens the batch results modal, sees the failed row carrying a specific, plain-English explanation of what went wrong, and one clear primary button that retries just that one resume — no full-batch redo, no quota burn. While retrying, the row shows a spinner; SSE pushes the real state transitions in real time. If the retry also fails with a different category, the row re-renders with the new headline. After 2 retries, the button disappears and a small "Reached retry limit — start a new batch to try again" hint replaces it.

**Critical sub-requirements:**
- DO NOT call the retry endpoint optimistically. Wait for the BE's `{ ok: true }` response before considering the retry "in flight." If the endpoint returns 409 or 429, surface a toast and leave the row untouched.
- DO NOT update the row's state manually after a successful retry response — the SSE handler is the source of truth for state transitions. Manual updates create races.
- The retry button MUST be visually primary (same weight as the main CTAs in step-results), not buried as a secondary link. The user's frustration is they couldn't retry — make the affordance obvious.
- Legacy rows with plain-string errors: render the string as the userMessage and show the retry button (because the synthesized envelope sets `retryable: true`). When the user hits retry on a legacy row, the BE handles it normally — there's no special legacy code path.

**verify:**
- `cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend && npm run build` exits 0
- `npm run lint` exits 0
- Manual: stage Saeed's resume + 3 JDs in the batch flow. After the run completes with the expected 2-success/1-fail pattern (assuming Tasks A/B/C aren't deployed yet for this manual check, OR after they're deployed force a failure by uploading a JD that legitimately doesn't fit), confirm the failed row shows the new category-specific headline + a prominent "Retry this resume" button.
- Manual: tap retry. Watch the row state transition `failed → queued → in_progress → completed | failed` in real time via SSE. The other two rows must not re-render.
- Manual: trigger 3 retries on the same job. After the 2nd succeeds at the BE limit, the 3rd attempt's button click must show the toast and not fire another request.

**agency:** `Frontend Developer`

**docs:**
- Component conventions doc if FE has one
- The shared `MatchScoreBlock` pattern in `src/app/shared/types/` is the precedent for cross-stack interface mirroring — follow the same approach for `BatchJobError`

---

## Cross-task verification (end-to-end)

After all six tasks land:

1. BE: `npm run build && npm run lint` both green.
2. BE: TypeORM migration for `retry_count` runs cleanly against a fresh DB (`npm run typeorm migration:run` against a local copy).
3. FE: `npm run build && npm run lint` both green.
4. Deploy BE to Railway (PR review first), apply migration, deploy.
5. Deploy FE.
6. Re-run Muhammad Saeed's 3-batch flow against the same 3 JDs from the May-12 incident (job_applications `9c0bab50…` and similar). Expected: all 3 succeed on the first pass thanks to Layers 1+2+3.
7. Force a failure: temporarily make `validateNoExperienceDropped` throw on a specific job. Confirm the failed row in the FE shows `AI_TRUNCATION` headline + retry button. Tap retry. Confirm the row updates via SSE to success.
8. Force a 429: hit the retry button 3 times in a row on the same job. Confirm the 3rd attempt surfaces the limit toast and disables the button.
9. Inspect Railway logs: confirm the new Claude telemetry line is present for every optimizer call, and confirm at least one `attempt=2` retry line exists in the post-deploy week — that's our signal that Layer 3 is actually firing on intermittent failures.

If post-deploy the failure rate at the user-visible layer doesn't drop to <1%, the bug isn't where we thought. Re-open the investigation with the Claude `stop_reason` data Task A is now logging.
