# BE-Owned Application Tracking — Verification Runbook

Run top-to-bottom. Every step has an explicit pass/fail criterion. **Stop at the first failure** and report which step + observed vs expected.

Set these once at the top of your shell:

```bash
export ATS_BE=/Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend
export ATS_FE=/Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend
export DATABASE_URL='postgres://...'                       # your local Postgres
export TEST_USER='00000000-0000-0000-0000-000000000000'    # uuid of your local test account
export AFFECTED_USER='7ebb4dd5-051d-42ac-a4e5-9bb8e30a60de' # the original bug report user (only if you have prod-copy data)
```

---

## Phase 0 — Pre-flight (must pass before applying migrations)

### 0.1 Confirm you are on the right branch

```bash
git -C "$ATS_BE" branch --show-current
git -C "$ATS_FE" branch --show-current
```

**Pass:** both print `feat/be-owned-application-tracking`.

### 0.2 Build + lint clean

```bash
cd "$ATS_BE" && npm run build && npm run lint
cd "$ATS_FE" && npm run build && npm run lint
```

**Pass:** both repos exit 0 on each command. No new errors (pre-existing Tailwind warnings ignored).

### 0.3 No pre-existing duplicate `resume_generation_id` rows would block the unique index

```bash
psql "$DATABASE_URL" -c "
SELECT resume_generation_id, COUNT(*) AS dup_count
FROM job_applications
WHERE resume_generation_id IS NOT NULL
GROUP BY resume_generation_id
HAVING COUNT(*) > 1;
"
```

**Pass:** zero rows.
**Fail action:** decide per-row which `job_applications` row to keep, delete the rest, re-run. Migration would otherwise abort at `CREATE UNIQUE INDEX`.

### 0.4 Baseline row counts (used by deltas below)

```bash
psql "$DATABASE_URL" -c "
SELECT
  (SELECT COUNT(*) FROM job_applications)                                         AS ja_total,
  (SELECT COUNT(*) FROM job_applications WHERE user_id = '$TEST_USER')            AS ja_test_user,
  (SELECT COUNT(*) FROM resume_generations)                                       AS rg_total,
  (SELECT COUNT(*) FROM resume_generations rg
     WHERE COALESCE(rg.\"userId\"::text, rg.user_id) IS NOT NULL
       AND COALESCE(rg.\"userId\"::text, rg.user_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$'
       AND NOT EXISTS (SELECT 1 FROM job_applications ja WHERE ja.resume_generation_id = rg.id)
  ) AS orphan_count_pre_backfill;
"
```

**Pass:** record these four numbers. `orphan_count_pre_backfill` will drop to 0 after migration in Phase 1.

---

## Phase 1 — Migrations

### 1.1 Apply both migrations

```bash
cd "$ATS_BE" && npm run migration:run
```

**Pass:** output contains both:
- `migration AddUniqueResumeGenerationOnJobApplications1815100000000 has been executed`
- `migration BackfillMissingTrackedApplications1815100100000 has been executed`

Order matters — unique index must apply before backfill (timestamp-ordering guarantees this).

### 1.2 Verify the partial unique index exists with the correct shape

```bash
psql "$DATABASE_URL" -c "\d job_applications" | grep uq_job_applications_resume_generation_id
```

**Pass:** output contains all three of: `UNIQUE`, `btree (resume_generation_id)`, `WHERE (resume_generation_id IS NOT NULL)`.

### 1.3 Verify backfill closed the gap

```bash
psql "$DATABASE_URL" -c "
SELECT COUNT(*) AS orphans_post_backfill
FROM resume_generations rg
WHERE COALESCE(rg.\"userId\"::text, rg.user_id) IS NOT NULL
  AND COALESCE(rg.\"userId\"::text, rg.user_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$'
  AND NOT EXISTS (SELECT 1 FROM job_applications ja WHERE ja.resume_generation_id = rg.id);
"
```

**Pass:** `orphans_post_backfill = 0`.

### 1.4 Verify backfill respected the uuid regex (skipped malformed user_id rows)

```bash
psql "$DATABASE_URL" -c "
SELECT COUNT(*) AS malformed_skipped
FROM resume_generations rg
WHERE COALESCE(rg.\"userId\"::text, rg.user_id) IS NOT NULL
  AND COALESCE(rg.\"userId\"::text, rg.user_id) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\$'
  AND NOT EXISTS (SELECT 1 FROM job_applications ja WHERE ja.resume_generation_id = rg.id);
"
```

**Pass:** any number — these were intentionally skipped. Confirm zero rows have a valid uuid format **and** are still orphans (covered by 1.3).

### 1.5 Backfill row integrity — newly inserted rows have the expected shape

```bash
psql "$DATABASE_URL" -c "
SELECT
  COUNT(*)                                                                       AS total,
  COUNT(*) FILTER (WHERE application_source = 'tailored_resume')                 AS source_ok,
  COUNT(*) FILTER (WHERE status = 'applied')                                     AS status_ok,
  COUNT(*) FILTER (WHERE applied_at IS NOT NULL)                                 AS applied_at_ok,
  COUNT(*) FILTER (WHERE jsonb_typeof(status_history) = 'array'
                     AND jsonb_array_length(status_history) = 1)                 AS history_ok,
  COUNT(*) FILTER (WHERE resume_generation_id IS NOT NULL)                       AS rg_id_ok
FROM job_applications
WHERE created_at = updated_at  -- backfilled rows have created_at == updated_at == rg.created_at
  AND application_source = 'tailored_resume';
"
```

**Pass:** all six counters equal each other (every backfilled row has every field correct).

### 1.6 Affected user from the original bug report (skip if you don't have prod-copy data)

```bash
psql "$DATABASE_URL" -c "
SELECT company_name, job_position, resume_generation_id, created_at
FROM job_applications
WHERE user_id = '$AFFECTED_USER'
ORDER BY created_at DESC;
"
```

**Pass:** 3 rows for this user.
- 1× `Kake / Senior Software Engineer (Nest.JS + Angular) - Remote` from 2026-05-15 13:27 (original single-flow row, untouched)
- 1× `Kake / Senior Software Engineer (Nest.JS + Angular) - Remote` from 2026-05-15 13:31 (bulk, backfilled)
- 1× `InnovationTeam / Senior Front End Engineer - Remote` from 2026-05-15 13:31 (bulk, backfilled)

If only 1 row → backfill did not run or your local DB doesn't have prod-copy data.

### 1.7 Re-running the backfill is a no-op (idempotency)

```bash
cd "$ATS_BE" && npm run migration:run
```

**Pass:** says "No migrations are pending."

If you want to test re-run safety explicitly, manually re-execute the backfill body in psql:

```bash
psql "$DATABASE_URL" <<'SQL'
INSERT INTO job_applications (
  user_id, resume_generation_id, company_name, job_position, job_description,
  application_source, status, applied_at, created_at, updated_at, status_history
)
SELECT
  COALESCE(rg."userId"::text, rg.user_id), rg.id,
  COALESCE(NULLIF(TRIM(rg.company_name), ''), 'Unknown Company'),
  COALESCE(NULLIF(TRIM(rg.job_position), ''), 'Unknown Position'),
  rg.job_description, 'tailored_resume', 'applied',
  rg.created_at, rg.created_at, rg.created_at,
  jsonb_build_array(jsonb_build_object(
    'from', NULL, 'to', 'applied',
    'changed_at', to_char(rg.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'changed_by_user_id', COALESCE(rg."userId"::text, rg.user_id)
  ))
FROM resume_generations rg
WHERE COALESCE(rg."userId"::text, rg.user_id) IS NOT NULL
  AND COALESCE(rg."userId"::text, rg.user_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND NOT EXISTS (SELECT 1 FROM job_applications ja WHERE ja.resume_generation_id = rg.id)
ON CONFLICT ON CONSTRAINT uq_job_applications_resume_generation_id
DO NOTHING;
SQL
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM job_applications;"
```

**Pass:** total count unchanged from after step 1.5.

---

## Phase 2 — Stacks up + log channel ready

### 2.1 Start both stacks

```bash
cd "$ATS_BE" && npm run start:dev &
cd "$ATS_FE" && npm start &
```

**Pass:** backend reachable at `localhost:3000/api/v1/health` returns 200; frontend at `localhost:4200`.

### 2.2 Open a tail on backend logs in a separate terminal

```bash
# Wherever your dev logs stream — Nest console output, journalctl, etc.
# Keep this open. We'll grep it for structured-log events below.
```

You'll be checking for these specific event names appearing in the logs during later steps:
- `resume_generation.stage_failed`
- `resume_generation.persist_failed`
- `resume_generation.request_failed`
- `batch_v2.transition_failed`
- `batch_v2.sse_publish_failed`
- `batch_v2.complete_persist_failed`
- `batch_v2.failure_persist_failed`
- `batch_v2.bump_run_counters_failed`
- `batch_v2.maybe_finish_failed`
- `batch_v2.job_failed`

Plus these INFO lines:
- `Tracking tailoring application for user <id>, resume_generation <id>`
- `Tailoring application already tracked for resume_generation <id> — skipping`

---

## Phase 3 — Happy-path functional verification

Snapshot before each step. Reset / re-baseline by deleting the test user's recent rows between runs if you want isolated deltas.

```bash
# Helper: print current test user row count
function ja_count() {
  psql "$DATABASE_URL" -tAc "SELECT COUNT(*) FROM job_applications WHERE user_id='$TEST_USER';"
}
echo "Baseline: $(ja_count)"
```

### 3.1 Single tailor + Done button

1. Sign in as the test user in the browser.
2. Tailor 1 resume (use any job description ≥ 20 chars).
3. After pdf delivered, click the modal's "Done" button.

```bash
echo "After 3.1: $(ja_count)"
psql "$DATABASE_URL" -c "
SELECT company_name, job_position, application_source, status, resume_generation_id
FROM job_applications
WHERE user_id='$TEST_USER'
ORDER BY created_at DESC LIMIT 1;
"
```

**Pass:** count = baseline + 1. Last row has `application_source='tailored_resume'`, `status='applied'`, populated `resume_generation_id`.

### 3.2 Single tailor + ESC key dismiss

Same as 3.1 but press **ESC** after pdf delivered instead of Done.

**Pass:** count = baseline + 1. This is the bug-fix path — ESC used to drop tracking.

### 3.3 Single tailor + click backdrop (outside modal)

Same setup, dismiss by clicking outside the modal.

**Pass:** count = baseline + 1.

### 3.4 Single tailor + X icon

Same setup, click the X icon in modal header.

**Pass:** count = baseline + 1.

### 3.5 Batch tailor (2 jobs) + Done button

Use the Quick Tailor batch modal. Submit 2 jobs. After results step, click "Done" button (now a passive close — backend already tracked).

**Pass:** count = baseline + 2. Two new rows, both `tailored_resume`/`applied`, distinct `resume_generation_id`s.

### 3.6 Batch tailor (2 jobs) + ESC dismiss

Same setup, dismiss with ESC instead.

**Pass:** count = baseline + 2.

### 3.7 Batch tailor (2 jobs) + backdrop click dismiss

**Pass:** count = baseline + 2.

### 3.8 Batch tailor (2 jobs) + "Tailor Another Set" + close

Click "Tailor Another Set" (returns to input step), then close via any method.

**Pass:** count = baseline + 2.

### 3.9 Batch tailor (3 jobs)

Plan caps batch at 3 jobs (`MAX_JOBS = 3` in `batch-job-input.component.ts`). Submit max.

**Pass:** count = baseline + 3.

### 3.10 UI assertion — Tracked badge renders, no Track All button

On the results step of the batch modal, visually confirm:
- A row showing "✓ Tracked in Applications" (emerald check + label).
- A "Done" button next to it.
- **No** "Track All" button.
- Download All / Tailor Another Set buttons still present.

**Pass:** all of the above.

### 3.11 Dashboard refresh signal still fires

After closing a successful batch modal (any dismiss method), the dashboard should refresh and the new rows should appear in the Applications list **without manual page refresh**.

**Pass:** new rows visible immediately.

---

## Phase 4 — Edge cases & failure isolation

### 4.1 Idempotency — same `resume_generation_id` cannot duplicate

Pick any `resume_generation_id` that already has a `job_applications` row. Attempt to insert a duplicate manually:

```bash
psql "$DATABASE_URL" -c "
INSERT INTO job_applications (user_id, resume_generation_id, company_name, job_position, application_source, status, applied_at)
SELECT user_id, resume_generation_id, 'DUP TEST', 'DUP TEST', 'tailored_resume', 'applied', NOW()
FROM job_applications
WHERE resume_generation_id IS NOT NULL
LIMIT 1;
"
```

**Pass:** Postgres raises `duplicate key value violates unique constraint "uq_job_applications_resume_generation_id"`. No row inserted.

### 4.2 Service-level idempotency — `trackTailoringApplication` returns null on dup (not throw)

Trigger a re-track for an already-tracked generation. Easiest path: temporarily make a Bull worker retry an already-completed batch job. Alternatively, observe natural retries in your local queue.

Grep the backend log:

```bash
# From your log tail:
grep "already tracked" /path/to/be.log | head -5
```

**Pass:** at least one log line `Tailoring application already tracked for resume_generation <id> — skipping`. **No** error or exception stack near it.

### 4.3 Tracking failure does NOT abort pdf delivery

Simulate a tracking failure by temporarily dropping the partial unique index name match in the helper, then attempt a single tailor.

**Easier simulation:** in `JobApplicationService.trackTailoringApplication`, briefly add `throw new Error('synthetic failure')` at the top of the method body, restart BE, run a single tailor.

**Pass:**
- User receives the pdf normally.
- Backend log contains an ERROR line with `event="resume_generation.stage_failed"` OR `Failed to auto-track application for resume_generation <id>`.
- The pdf-success log still fires (`Resume generation completed in Xms`).
- **No row created** for that `resume_generation_id` (we threw before insert).

**Revert** the synthetic throw before continuing.

### 4.4 Low-fit warning aborts pipeline — NO tracking row created

Submit a job description completely unrelated to your test user's resume (e.g., paste a "Senior Sushi Chef" job description for a software engineer). Without `acknowledgeLowFit`, the orchestrator returns `low_fit_warning` and aborts the tailor.

```bash
echo "Pre: $(ja_count)"
# Submit the low-fit job through the UI, decline the warning
echo "Post: $(ja_count)"
```

**Pass:** count unchanged. No row created (pipeline never reached the pdf return).

### 4.5 Generation failure (single flow) — NO orphan tracking row

Force a generation failure by temporarily breaking the LLM call (e.g., set an invalid `ANTHROPIC_API_KEY`, restart BE), then attempt a single tailor.

```bash
echo "Pre: $(ja_count)"
# Attempt tailor; UI shows error
echo "Post: $(ja_count)"
```

**Pass:** count unchanged. The orchestrator threw before reaching the tracker, so no row exists.

Also check log:
```bash
grep "resume_generation.stage_failed\|resume_generation.request_failed" /path/to/be.log | tail -5
```

**Pass:** at least one structured log line carries `stage`, `userId`, `jobPosition`, `companyName`, `errorMessage`, and a stack trace on the next log line.

**Revert** the broken env var.

### 4.6 Generation failure (batch flow) — partial success

Set up a batch where ONE of the jobs is guaranteed to fail (e.g., an empty company name — though FE validates ≥ 2 chars, you may need to bypass via API call directly, or wait for an organic failure with poor LLM output). Submit a 2-job batch where one succeeds and one fails.

```bash
echo "Pre: $(ja_count)"
# Submit 2-job batch, one fails
echo "Post: $(ja_count)"
```

**Pass:** count = baseline + 1 (only succeeded job tracked). Failed job logs `batch_v2.job_failed` with category + technicalDetail.

### 4.7 SSE publish failure — worker still finishes (`safeEmit` isolation)

Hard-test: in `BatchTailoringV2EventsGateway.publish` (`batch-tailoring-v2.events.gateway.ts:16-21`), temporarily make it throw:

```typescript
publish(envelope: BatchEventEnvelope): void {
  throw new Error('synthetic sse failure');
}
```

Restart BE, submit a 2-job batch.

**Pass:**
- Both `job_applications` rows are still created (count = baseline + 2).
- Backend log has multiple `event="batch_v2.sse_publish_failed"` ERROR lines with `sseEvent`, `batchId`, `batchJobId`, `userId`.
- Bull job marked completed (check via `batch_tailoring_runs.status = 'completed'`).
- Frontend may show stuck "processing" UI (no SSE events received) — that's expected isolation; user can reload to see snapshot.

**Revert** the synthetic throw.

### 4.8 `maybeFinishBatch` failure does NOT trigger Bull retry

In `batch-tailoring-v2.processor.ts`, find the `maybeFinishBatch` method (~line 472). Temporarily add `throw new Error('synthetic finalize failure');` at the top of its body. Restart BE. Submit a 1-job batch.

**Pass:**
- The single job's `job_applications` row IS created (verified via baseline + 1).
- Bull does NOT retry the worker job — confirm with:
  ```bash
  psql "$DATABASE_URL" -c "SELECT id, state, retry_count FROM batch_tailoring_jobs ORDER BY created_at DESC LIMIT 1;"
  ```
  Expected: `state='completed'`, `retry_count=0`.
- Backend log has `event="batch_v2.maybe_finish_failed"`.
- `batch_tailoring_runs` row for this batch stays at non-terminal status (`processing`) since the finalize was the bit that flips it — that's expected behavior under the synthetic failure.

**Revert** the synthetic throw.

### 4.9 Bull retry of a worker — no duplicate tracking

Real-world retry simulation: kill BE mid-processing of a batch job (`pkill -9 node` while a batch worker is mid-job). Restart BE. Bull will re-deliver the job.

```bash
psql "$DATABASE_URL" -c "
SELECT resume_generation_id, COUNT(*)
FROM job_applications
WHERE user_id='$TEST_USER'
GROUP BY resume_generation_id
HAVING COUNT(*) > 1;
"
```

**Pass:** zero rows (no duplicates created by Bull's re-delivery).

Also grep:
```bash
grep "already tracked" /path/to/be.log | tail -3
```

**Pass:** "already tracked — skipping" line present for the retried `resume_generation_id`.

### 4.10 Page reload mid-batch — backend still tracks

Submit a 2-job batch. While the modal is in `processing` state, **reload the browser tab**. Don't reopen the modal.

```bash
sleep 30  # let batch finish
echo "After 4.10: $(ja_count)"
```

**Pass:** count = baseline + 2. FE was offline but BE auto-tracked anyway. This is the core fix.

### 4.11 Browser tab closed mid-batch — backend still tracks

Same as 4.10 but **close the entire tab/browser** instead of reloading.

**Pass:** count = baseline + 2.

### 4.12 Concurrent batch workers race — one wins, one logs skip

If your Bull config has `concurrency >= 2` (check `BATCH_V2_WORKER_CONCURRENCY`), submit batches simultaneously. Concurrent insert attempts on the same `resume_generation_id` (e.g., from a retry race) will land — confirm:

```bash
grep "23505\|uq_job_applications_resume_generation_id" /path/to/be.log
grep "already tracked" /path/to/be.log
```

**Pass:** any 23505 conflict is caught and logged as "already tracked" — never as an unhandled exception that fails the worker.

### 4.13 Tracking failure logs include full context (structured log shape)

Find any auto-track failure log line you generated above (4.3 or organic). Confirm the JSON payload (first arg to `logger.error`) contains every required key:

```bash
grep "resume_generation.stage_failed\|batch_v2\." /path/to/be.log | head -3 | python3 -c '
import json, sys, re
for line in sys.stdin:
    # Extract the JSON-looking substring
    m = re.search(r"\{.*\}", line)
    if not m: continue
    try:
        d = json.loads(m.group(0))
        required = {"event", "userId", "errorName", "errorMessage"}
        missing = required - set(d.keys())
        print("OK" if not missing else f"MISSING: {missing}")
        if "stage" in d: print(f"  stage={d[\"stage\"]}")
        if "batchId" in d: print(f"  batchId={d[\"batchId\"]}")
    except: pass
'
```

**Pass:** every line prints `OK` and shows either `stage=` (single flow) or `batchId=` (batch flow).

### 4.14 FE no longer POSTs to `/job-applications` from tailor-apply flows

Open browser DevTools → Network tab → filter for `job-applications`. Run a single tailor and a batch tailor end-to-end.

**Pass:** **zero** outbound `POST /api/v1/job-applications` requests during either flow. The only `/job-applications` traffic should be the `GET` made by the dashboard refresh after modal close.

**Counter-check:** the "Manual Add Application" feature elsewhere in the app should still POST normally — that's intentional, only tailor-apply was migrated.

### 4.15 BatchJobResult.jobDescription present on snapshot replay

Hit the snapshot endpoint for a recently completed batch:

```bash
BATCH_ID='<recent batch_id>'
TOKEN='<your jwt>'
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v1/resume-tailoring/batch/v2/$BATCH_ID/status" \
  | python3 -m json.tool | grep -A 1 '"jobDescription"'
```

**Pass:** every completed job's `result.jobDescription` is the original user-typed string. Failed jobs may omit it (they don't carry a `BatchJobResult`).

### 4.16 `resume_generation_id` FK integrity after backfill

```bash
psql "$DATABASE_URL" -c "
SELECT COUNT(*) AS broken_fks
FROM job_applications ja
WHERE ja.resume_generation_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM resume_generations rg WHERE rg.id = ja.resume_generation_id);
"
```

**Pass:** `broken_fks = 0`. Backfill referenced existing `resume_generations.id` only — no dangling FK.

### 4.17 No row regression — total `job_applications` count is monotonic

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM job_applications;"
```

**Pass:** current total ≥ Phase 0.4 baseline. Migration only inserts, never deletes.

---

## Phase 5 — Roll-forward / roll-back drill

### 5.1 Roll back the new migrations

```bash
cd "$ATS_BE"
npm run migration:revert   # reverts BackfillMissingTrackedApplications1815100100000 (no-op down)
npm run migration:revert   # reverts AddUniqueResumeGenerationOnJobApplications1815100000000 (drops index)
```

**Pass:** both revert without error. Confirm index gone:

```bash
psql "$DATABASE_URL" -c "\d job_applications" | grep uq_job_applications_resume_generation_id
```

**Pass:** no match (index dropped). Backfilled rows remain (down is intentional no-op — verify):

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM job_applications;"
```

**Pass:** count unchanged from end of Phase 4 (down does NOT delete backfilled rows; that's a documented design decision).

### 5.2 Re-apply forward

```bash
npm run migration:run
```

**Pass:** both run again cleanly. `ON CONFLICT DO NOTHING` makes the re-run a no-op on already-present rows.

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM job_applications;"
```

**Pass:** count identical to before the revert (no new rows since they already exist; no duplicates because of the unique index).

---

## Phase 6 — Report

Required information for the "T14 green" signal:

| # | Check | Pass / Fail / Skipped |
|---|---|---|
| 0.1 | Branch | |
| 0.2 | Build + lint | |
| 0.3 | No pre-existing dups | |
| 0.4 | Baseline recorded | |
| 1.1 | Migrations applied | |
| 1.2 | Unique index shape | |
| 1.3 | Orphans = 0 | |
| 1.4 | Malformed user_id rows skipped | |
| 1.5 | Backfilled row shape | |
| 1.6 | Affected user 3 rows | (skip if no prod copy) |
| 1.7 | Re-run idempotent | |
| 3.1-3.4 | Single, all 4 dismisses | |
| 3.5-3.8 | Batch×2, all 4 dismisses | |
| 3.9 | Batch×3 | |
| 3.10 | UI badge + no Track All | |
| 3.11 | Dashboard refresh | |
| 4.1-4.2 | Idempotency | |
| 4.3 | Failure isolation (single) | |
| 4.4 | Low-fit no row | |
| 4.5 | Single failure no orphan | |
| 4.6 | Batch partial success | |
| 4.7 | SSE failure isolation | |
| 4.8 | maybeFinishBatch no retry | |
| 4.9 | Bull retry idempotent | |
| 4.10-4.11 | Page reload / tab close | |
| 4.12 | Concurrent worker race | |
| 4.13 | Structured log shape | |
| 4.14 | FE no POSTs | |
| 4.15 | Snapshot jobDescription | |
| 4.16 | FK integrity | |
| 4.17 | Monotonic count | |
| 5.1-5.2 | Migration revert + reapply | |

When every row passes (or skipped with reason), reply with **"T14 green"** and I run T16 (single commit per repo + push + open PRs).

If any row fails, report the row number + observed vs expected + relevant log snippet, and I'll patch.
