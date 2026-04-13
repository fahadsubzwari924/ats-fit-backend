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
- [ ] **AC-RTL-06:** Batch endpoint processes jobs **sequentially** and returns per-job success/failure without failing the entire batch on one error.
- [ ] **AC-RTL-07:** Batch endpoint rejects requests with more than **3 jobs** with `400 Bad Request` and descriptive error message.
- [ ] **AC-RTL-08:** The diff endpoint (`GET /resume-tailoring/diff/:generationId`) is shared across single and batch generation — any `resumeGenerationId` from either flow can be passed.
- [ ] **AC-RTL-09:** The frontend exposes a full AI change-comparison view ("See what changed") for **both** single and batch tailored resumes, using the same `ResumeComparisonComponent`.
- [ ] **AC-RTL-10:** Resume history detail panel exposes a "See full changes" button that opens the full `ResumeComparisonComponent` in-place (no page navigation), consistent with the post-generation flow.

## Templates

- **`GET /resume-tailoring/templates`** — List available resume templates (**public**).

## Generate tailored resume (single)

- **`POST /resume-tailoring/generate`** — **Public** (no JWT required) but subject to **rate limits** (`FeatureType.RESUME_GENERATION`).
- **Multipart:** `resumeFile` (PDF) optional when resume already stored; body fields include job description, position, company, `templateId`, optional `resumeId` (see `GenerateTailoredResumeDto` in code).
- **Response:** Raw **PDF** stream (not JSON).
- **Response headers (client contract):** Include generation id, tailoring mode, keyword/section/achievement metrics, and optimization confidence (see controller `setPdfResponseHeaders` in code for exact header names).

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

## Orchestration (conceptual)

Single and batch generation go through an **orchestrator** that coordinates extraction sources, AI optimization, PDF build, and persistence of generation records. Exact steps and prompts: **see code** (`resume-generation-orchestrator.service` and related services).

## Related specs

- Upload and extraction: [04-profile-enrichment.md](./04-profile-enrichment.md)
- Limits: [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
