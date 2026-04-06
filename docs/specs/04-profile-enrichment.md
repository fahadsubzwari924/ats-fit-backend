---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Profile enrichment and resume upload

## Business intent

Establish **one canonical resume** per user and a **structured profile** (extracted text + Q&A + enrichment) so tailoring and scoring use consistent, high-signal candidate data—not a one-off upload each time.

## Traceability

| ID | Kind |
|----|------|
| REQ-002, REQ-003 | Functional |
| US-1 | User story (see [functional-requirements.md](./functional-requirements.md)) |

## Acceptance criteria

- [ ] **AC-PRF-01:** User can upload **one** PDF resume; second upload is rejected with a clear error.
- [ ] **AC-PRF-02:** Upload stores file in durable object storage and returns identifiers/URL needed by the client.
- [ ] **AC-PRF-03:** For the registered onboarding flow, extraction is **queued** and client can track processing via processed-resume APIs or profile status.
- [ ] **AC-PRF-04:** User can list and answer profile questions; skipping is supported per DTO rules; completeness recalculates.
- [ ] **AC-PRF-05:** When enrichment is triggered, client can poll **`/users/resume-profile-status`** until enriched profile is ready (per response contract).
- [ ] **AC-PRF-06:** User can mark onboarding complete once at end of flow.

## Upload (canonical PDF)

- **`POST /users/upload-resume`** — Authenticated; **PDF only**; **at most one** stored upload per user (second upload rejected).
- **Flow:** File stored in object storage → returns resume id, file name, URL.
- **Registered users:** Enqueues **async processing** (`resume_processing` queue) for extraction and onboarding questions; response may include `asyncProcessing` with `processingId` and status.

## Processed / extracted resumes

- **`GET /users/processed-resumes`** — List extraction records for the user.
- **`GET /users/processed-resumes/:processingId/status`** — Status for one record.
- **`DELETE /users/processed-resumes/:processingId`** — Remove processed record and associated data per service rules.

## Resume profile status (polling)

- **`GET /users/resume-profile-status`** — For UI polling after upload/Q&A: e.g. `hasResume`, `processingStatus`, question counts, `profileCompleteness`, `enrichedProfileId`, `tailoringMode` (see Swagger/controller for enum values).

## Profile questions

Base path: **`/resume-tailoring/profile-questions`** (JWT required).

- **`GET /`** — All **profile**-source questions with answer state; enriches display with extracted experience slice when applicable.
- **`POST /answer`** — Save one answer (including explicit skip via `null` response); recalculates completeness; when **all** questions answered, enqueues **profile enrichment** job.
- **`POST /complete`** — User explicitly finishes Q&A; enqueues enrichment; client continues polling **`/users/resume-profile-status`** until `enrichedProfileId` is available.

## Onboarding flag

- **`PATCH /users/onboarding/complete`** — Sets user onboarding completed (once at end of flow).

## Related specs

- Tailored generation using enriched profile: [03-resume-tailoring.md](./03-resume-tailoring.md)
- Feature usage display: [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
