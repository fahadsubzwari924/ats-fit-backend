---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-05-01
---

# Job applications (tracking)

## Business intent

Replace ad-hoc spreadsheets with a **single pipeline** for every application: what was applied, current status, next follow-up, and links back to the **tailored resume** used for the apply.

## Traceability

| ID | Kind |
|----|------|
| REQ-006 | Functional |
| US-3 | User story |

## Acceptance criteria

- [ ] **AC-JOB-01:** User can create an application with required company, position, and job description fields.
- [ ] **AC-JOB-02:** User can list applications with **search**, **status filter(s)**, **date ranges**, **pagination**, and **sort** as documented.
- [ ] **AC-JOB-03:** User can get **stats** for their own applications.
- [ ] **AC-JOB-04:** User can update status, notes, interview/follow-up fields, and metadata per DTO.
- [ ] **AC-JOB-05:** User can delete an application; deleted records are not returned on subsequent reads.
- [ ] **AC-JOB-06:** Optional links (`resume_generation_id`) and supporting metadata persist when provided.
- [ ] **AC-JOB-07:** Sparse **`fields`** query limits payload shape without breaking required security/ownership checks.
- [ ] **AC-JOB-08:** User can edit every core field (company, position, description, URL, location, salary, employment_type, work_mode, priority, tags, deadlines, recruiter/HM contacts, rejection details, offer compensation) via `PUT /:id`.
- [ ] **AC-JOB-09:** User can save jobs as wishlist before applying; `job_description` is not required for status `wishlist` or `interested`.

## Purpose

Persist a **single place** for the user to record applications: company, role, description, URLs, salary notes, pipeline status, follow-ups, and links to generation artifacts.

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
| `GET`    | `/:id/interviews`                 | List interview rounds for an application (ordered by scheduled_at ASC) |
| `POST`   | `/:id/interviews`                 | Create an interview round |
| `PUT`    | `/:id/interviews/:interviewId`    | Update an interview round |
| `DELETE` | `/:id/interviews/:interviewId`    | Delete an interview round |

## List query parameters (intended contract)

- **Search:** `q` — matches company or position (ILIKE).
- **Status:** `status` **or** `statuses` (comma-separated); if both present, **`statuses` wins**.
- **Filters:** `company_name`.
- **Date ranges:** `applied_at_from` / `applied_at_to`, `deadline_from` / `deadline_to`, `follow_up_from` / `follow_up_to` (validation rules in DTO/constraints in code).
- **Work mode:** `work_mode` — filters by WorkMode enum value.
- **Employment type:** `employment_type` — filters by EmploymentType enum value.
- **Priority:** `priority` — filters by ApplicationPriority enum value.
- **Job board:** `job_board_source` — filters by JobBoardSource enum value.
- **Tag:** `tag` — matches applications whose `tags` array contains this exact value.
- **Decision deadline range:** `decision_deadline_from` / `decision_deadline_to`.
- **Pagination:** `limit` (default 20), `offset` (default 0).
- **Sort:** `sort_by` (default `created_at`), `sort_order` (`ASC` | `DESC`, default `DESC`).
- **Sparse fields:** `fields` query (comma-separated) — **see** [09-api-conventions.md](./09-api-conventions.md).

## Ownership

Service methods resolve ownership from `request.userContext` and enforce record access per user identity.

## Domain enums (persisted)

**`ApplicationStatus` (11 states):**
`wishlist`, `interested`, `applied`, `screening`, `technical_round`, `interviewed`, `offer_received`, `accepted`, `offer_declined`, `rejected`, `withdrawn`

New pre-apply states: `wishlist` and `interested` allow saving a job before applying. `offer_declined` records when a received offer is turned down.

**Sourcing & context enums:**
- `JobBoardSource`: `linkedin`, `indeed`, `glassdoor`, `wellfound`, `company_site`, `referral`, `recruiter_outreach`, `other`
- `AppliedVia`: `easy_apply`, `company_portal`, `email`, `recruiter`, `referral`, `other`
- `EmploymentType`: `full_time`, `part_time`, `contract`, `internship`, `freelance`
- `WorkMode`: `remote`, `hybrid`, `onsite`
- `PayPeriod`: `annual`, `monthly`, `hourly`
- `ApplicationPriority`: `low`, `medium`, `high`, `top_choice`
- `RejectionStage`: `auto_rejected`, `after_screening`, `after_interview`, `after_offer_declined`, `other`
- `InterviewStage`: `recruiter_screen`, `hr_screen`, `take_home`, `technical`, `system_design`, `behavioral`, `hiring_manager`, `onsite_loop`, `final`, `other`
- `InterviewFormat`: `in_person`, `video`, `phone`
- `InterviewOutcome`: `pending`, `passed`, `failed`, `no_show`, `cancelled`

**`ApplicationSource`:** `direct_apply`, `tailored_resume`

## Payload highlights (create)

Includes company, position, job description, optional URL/location, salaries, `applied_at`, `application_source`, optional `resume_generation_id`, `resume_content`, cover letter, notes, `metadata` (see DTO for nullability).

## Salary model

Posted salary uses `salary_min` / `salary_max` (decimal, up to 12 digits), `salary_currency` (ISO 4217, e.g. `USD`), `pay_period` (`annual` | `monthly` | `hourly`), and `salary_negotiable` (boolean).

Offer-side compensation is stored as a structured `compensation_offer` jsonb object: `base_salary`, `bonus_amount`, `equity_value`, `equity_notes`, `sign_on_bonus`, `total_comp`, `currency`, `pay_period`, `benefits_notes`, `received_at`, `decision_deadline`.

## Status history

Every status change (including the initial state on create) is appended to the `status_history` jsonb array. Each entry records: `from` (previous status, null on first), `to` (new status), `changed_at` (ISO 8601), `changed_by_user_id` (optional).

## Metadata semantics

`PUT /:id` **shallow-merges** the incoming `metadata` object with the existing value (`{ ...existing, ...incoming }`). Sending `metadata: { key: "value" }` adds or overwrites only that key — it does not erase other keys already present.

## Related specs

- Generations: [03-resume-tailoring.md](./03-resume-tailoring.md)
- API patterns: [09-api-conventions.md](./09-api-conventions.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
