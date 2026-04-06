---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Job applications (tracking)

## Business intent

Replace ad-hoc spreadsheets with a **single pipeline** for every application: what was applied, current status, next follow-up, and links back to the **tailored resume** or **ATS run** that justified the apply.

## Traceability

| ID | Kind |
|----|------|
| REQ-007 | Functional |
| US-4 | User story |

## Acceptance criteria

- [ ] **AC-JOB-01:** User can create an application with required company, position, and job description fields.
- [ ] **AC-JOB-02:** User can list applications with **search**, **status filter(s)**, **date ranges**, **pagination**, and **sort** as documented.
- [ ] **AC-JOB-03:** User can get **stats** for their own applications.
- [ ] **AC-JOB-04:** User can update status, notes, interview/follow-up fields, and metadata per DTO.
- [ ] **AC-JOB-05:** User can delete an application; deleted records are not returned on subsequent reads.
- [ ] **AC-JOB-06:** Optional links (`ats_match_history_id`, `resume_generation_id`, score snapshots) persist when provided.
- [ ] **AC-JOB-07:** Sparse **`fields`** query limits payload shape without breaking required security/ownership checks.

## Purpose

Persist a **single place** for the user to record applications: company, role, description, URLs, salary notes, pipeline status, follow-ups, and links to ATS/generation artifacts.

## API (prefix `/job-applications`)

All routes use **JWT** (`JwtAuthGuard`).

| Method | Path | Behavior |
|--------|------|----------|
| `POST` | `/` | Create application; body maps to `CreateJobApplicationDto` |
| `GET` | `/` | List with query filters and pagination |
| `GET` | `/stats` | Aggregate stats for current user context |
| `GET` | `/:id` | Detail by UUID |
| `PUT` | `/:id` | Partial update (`UpdateJobApplicationDto`) |
| `DELETE` | `/:id` | Delete record |

## List query parameters (intended contract)

- **Search:** `q` — matches company or position (ILIKE).
- **Status:** `status` **or** `statuses` (comma-separated); if both present, **`statuses` wins**.
- **Filters:** `company_name`.
- **Date ranges:** `applied_at_from` / `applied_at_to`, `deadline_from` / `deadline_to`, `follow_up_from` / `follow_up_to` (validation rules in DTO/constraints in code).
- **Pagination:** `limit` (default 20), `offset` (default 0).
- **Sort:** `sort_by` (default `created_at`), `sort_order` (`ASC` | `DESC`, default `DESC`).
- **Sparse fields:** `fields` query (comma-separated) — **see** [09-api-conventions.md](./09-api-conventions.md).

## Ownership

Service methods resolve ownership from `request.userContext` and enforce record access per user identity.

## Domain enums (persisted)

**`ApplicationStatus`:** `applied`, `screening`, `technical_round`, `interviewed`, `offer_received`, `accepted`, `rejected`, `withdrawn`.

**`ApplicationSource`:** `direct_apply`, `tailored_resume`.

## Payload highlights (create)

Includes company, position, job description, optional URL/location, salaries, `applied_at`, `application_source`, optional `ats_match_history_id`, `resume_generation_id`, `ats_score`, `ats_analysis`, `resume_content`, cover letter, notes, `metadata` (see DTO for nullability).

## Related specs

- ATS artifacts: [05-ats-matching.md](./05-ats-matching.md)
- Generations: [03-resume-tailoring.md](./03-resume-tailoring.md)
- API patterns: [09-api-conventions.md](./09-api-conventions.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
