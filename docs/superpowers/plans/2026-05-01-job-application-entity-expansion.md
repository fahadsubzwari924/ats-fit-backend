# Job Application Entity — Highly-Valuable Field Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Job Application a fully editable, realistic tracker that competes with Teal/Huntr/Simplify by (a) allowing edits to every core field from the sidebar, (b) replacing the broken salary model with a structured min/max/currency/period model plus offer-side comp, (c) promoting hidden metadata fields (job board, applied via, work mode, employment type) to first-class queryable columns, (d) introducing multi-round interview tracking as a child resource, (e) recording status transitions in a `status_history` jsonb column, and (f) supporting wishlist/save-for-later applications.

**Architecture:**
- **Schema-first.** Two TypeORM migrations: `20260501000001` expands `job_applications` (renames + new columns + new enum members), `20260501000002` creates the `job_application_interviews` child table.
- **Convention compliance.** Every new enum lives in its own file under `src/modules/job-application/enums/`; every new structured-jsonb shape lives in its own `interfaces/<concept>.interface.ts` file (per `.ai/rules.md` rule 13 + `docs/CONVENTIONS.md` "Type, interface, and enum placement").
- **No magic strings.** All new statuses, sources, modes, periods, stages, and outcomes are typed enums imported from `enums/`.
- **Service-side side-effects.** Status changes auto-append to `status_history` jsonb. `metadata` is now deep-merged on update instead of overwritten.
- **Sub-resource for interviews.** `POST /job-applications/:id/interviews`, `GET /:id/interviews`, `PUT /:id/interviews/:interviewId`, `DELETE /:id/interviews/:interviewId` — full CRUD via a new `JobApplicationInterviewService` and `JobApplicationInterviewController`.
- **Project constraints honored:** **no new unit tests** (per commit `ac25482`), **no mid-task commits** — one commit at the end via Task 22. Verification per task uses `npm run build`, `npm run lint`, and (where applicable) running the migration locally.

**Tech Stack:** TypeScript (strict), NestJS, TypeORM (Postgres), class-validator, class-transformer, @nestjs/swagger.

---

## File Structure

### Files to create

```
src/database/migrations/
  20260501000001-expand-job-application-fields.ts          ← schema expansion
  20260501000002-create-job-application-interviews.ts      ← child table

src/database/entities/
  job-application-interview.entity.ts                       ← TypeORM mapping for interview rounds

src/modules/job-application/enums/
  job-board-source.enum.ts        ← LinkedIn / Indeed / Glassdoor / Wellfound / CompanySite / Referral / Recruiter / Other
  applied-via.enum.ts             ← EasyApply / CompanyPortal / Email / Recruiter / Referral / Other
  employment-type.enum.ts         ← FullTime / PartTime / Contract / Internship / Freelance
  work-mode.enum.ts               ← Remote / Hybrid / Onsite
  pay-period.enum.ts              ← Annual / Monthly / Hourly
  application-priority.enum.ts    ← Low / Medium / High / TopChoice
  rejection-stage.enum.ts         ← AutoRejected / AfterScreening / AfterInterview / AfterOffer / Other
  interview-stage.enum.ts         ← RecruiterScreen / HRScreen / TakeHome / Technical / SystemDesign / Behavioral / HiringManager / OnsiteLoop / Final / Other
  interview-format.enum.ts        ← InPerson / Video / Phone
  interview-outcome.enum.ts       ← Pending / Passed / Failed / NoShow / Cancelled

src/modules/job-application/interfaces/
  job-application-contact.interface.ts             ← shape of items in `contacts` jsonb array
  job-application-attachment.interface.ts          ← shape of items in `attachments` jsonb array
  job-application-status-history.interface.ts      ← shape of items in `status_history` jsonb array
  job-application-compensation-offer.interface.ts  ← shape of `compensation_offer` jsonb object

src/modules/job-application/dtos/
  job-application-interview.dto.ts                  ← Create + Update DTOs for the interview sub-resource

src/modules/job-application/services/
  job-application-interview.service.ts             ← CRUD for interview rounds, ownership-checked via parent
  job-application-status-history.helper.ts         ← pure helper: append entry on status change

src/modules/job-application/controllers/
  job-application-interview.controller.ts          ← /:id/interviews sub-resource controller
```

> Note: existing service file lives at `src/modules/job-application/job-application.service.ts` (not `services/`). New related services go in `services/` per CONVENTIONS to keep files <200 LOC. Existing files stay where they are to avoid scope creep.

### Files to modify

```
src/database/entities/job-application.entity.ts                    ← add new columns, rename salary, extend ApplicationStatus
src/modules/job-application/dtos/job-application.dto.ts            ← Create + Update DTOs gain every new field; Update gains core job fields
src/modules/job-application/dtos/job-application-response.dto.ts   ← surface every new field in responses
src/modules/job-application/dtos/job-application-query.dto.ts      ← add filters: work_mode, employment_type, priority, tags, job_board_source
src/modules/job-application/interfaces/job-application.interface.ts ← extend ICreate/IUpdate/IQuery to match DTOs
src/modules/job-application/job-application.service.ts             ← metadata MERGE (not overwrite); status_history append; new field assignment in create+update
src/modules/job-application/job-application.controller.ts          ← mapToResponseDto includes new fields; controller passes new fields through
src/modules/job-application/job-application.module.ts              ← register JobApplicationInterview entity, new service, new controller
src/modules/job-application/config/field-selection.config.ts       ← extend allowedFields with every new top-level column
docs/specs/06-job-applications.md                                  ← document new fields, interview sub-resource, status taxonomy, salary model
```

---

## Decision log (pinned for executors)

1. **Salary rename is breaking, no shim.** Per `.ai/rules.md` ("No backwards-compatibility shims"), `current_salary` → `salary_min`, `expected_salary` → `salary_max`. The migration uses `ALTER TABLE ... RENAME COLUMN`. The mobile/web client must update at the same time. Blast radius confirmed: 7 files inside this module + 1 historical create-table migration (do **not** edit historical migrations).
2. **Status taxonomy gains 3 entries.** New `ApplicationStatus` members: `WISHLIST`, `INTERESTED`, `OFFER_DECLINED`. Existing 8 entries unchanged. `WISHLIST` becomes the new default for create when `applied_at` is omitted **and** `application_source = direct_apply`; existing default behavior (status=APPLIED) only fires when `applied_at` is provided or source is `tailored_resume`.
3. **`job_description` is no longer required on create.** Required only when `status` is at-or-past `APPLIED`. Wishlist/Interested can have an empty description.
4. **`metadata` is merged, not replaced.** Service performs `{ ...existing, ...incoming }` (shallow merge — sufficient for v1, since metadata keys are flat).
5. **Status history is jsonb, not a child table.** Read-mostly data, low cardinality (max ~10 transitions per app), keeps the migration footprint small. If/when analytics need cross-user querying, promote to a child table.
6. **Contacts and attachments are jsonb arrays, not child tables.** Same rationale. Recruiter/HM convenience fields stay top-level for the 80% case where there is exactly one of each.
7. **Interviews ARE a child table.** A loop has high cardinality (5–8 events per app for tech roles), users need timeline queries, and the data has its own lifecycle (reschedules, cancellations). jsonb would lose too much.

---

## Task list

Each task carries the project-required schema: **path / intent / verify / agency / docs**.

---

### Task 1: Add new enum files (10 enums, one file each)

- **path:** `src/modules/job-application/enums/{job-board-source,applied-via,employment-type,work-mode,pay-period,application-priority,rejection-stage,interview-stage,interview-format,interview-outcome}.enum.ts`
- **intent:** Provide typed string enums for every new domain dimension introduced; eliminates magic strings in entity/DTO/service.
- **verify:** `npm run build` — expect zero errors. `grep -r "enum " src/modules/job-application/enums/` — expect 10 matches.
- **agency:** `subagentType: "Backend Architect"` (Claude Code) / `cursorRule: "@agency-backend-architect.mdc"` (Cursor)
- **docs:** `.ai/rules.md` (rule 13 + "Naming"), `docs/CONVENTIONS.md` ("Type, interface, and enum placement"), `docs/CONVENTIONS.md` (NestJS section).

- [ ] **Step 1.1:** Create `src/modules/job-application/enums/job-board-source.enum.ts`

```ts
export enum JobBoardSource {
  LINKEDIN = 'linkedin',
  INDEED = 'indeed',
  GLASSDOOR = 'glassdoor',
  WELLFOUND = 'wellfound',
  COMPANY_SITE = 'company_site',
  REFERRAL = 'referral',
  RECRUITER_OUTREACH = 'recruiter_outreach',
  OTHER = 'other',
}
```

- [ ] **Step 1.2:** Create `src/modules/job-application/enums/applied-via.enum.ts`

```ts
export enum AppliedVia {
  EASY_APPLY = 'easy_apply',
  COMPANY_PORTAL = 'company_portal',
  EMAIL = 'email',
  RECRUITER = 'recruiter',
  REFERRAL = 'referral',
  OTHER = 'other',
}
```

- [ ] **Step 1.3:** Create `src/modules/job-application/enums/employment-type.enum.ts`

```ts
export enum EmploymentType {
  FULL_TIME = 'full_time',
  PART_TIME = 'part_time',
  CONTRACT = 'contract',
  INTERNSHIP = 'internship',
  FREELANCE = 'freelance',
}
```

- [ ] **Step 1.4:** Create `src/modules/job-application/enums/work-mode.enum.ts`

```ts
export enum WorkMode {
  REMOTE = 'remote',
  HYBRID = 'hybrid',
  ONSITE = 'onsite',
}
```

- [ ] **Step 1.5:** Create `src/modules/job-application/enums/pay-period.enum.ts`

```ts
export enum PayPeriod {
  ANNUAL = 'annual',
  MONTHLY = 'monthly',
  HOURLY = 'hourly',
}
```

- [ ] **Step 1.6:** Create `src/modules/job-application/enums/application-priority.enum.ts`

```ts
export enum ApplicationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  TOP_CHOICE = 'top_choice',
}
```

- [ ] **Step 1.7:** Create `src/modules/job-application/enums/rejection-stage.enum.ts`

```ts
export enum RejectionStage {
  AUTO_REJECTED = 'auto_rejected',
  AFTER_SCREENING = 'after_screening',
  AFTER_INTERVIEW = 'after_interview',
  AFTER_OFFER_DECLINED = 'after_offer_declined',
  OTHER = 'other',
}
```

- [ ] **Step 1.8:** Create `src/modules/job-application/enums/interview-stage.enum.ts`

```ts
export enum InterviewStage {
  RECRUITER_SCREEN = 'recruiter_screen',
  HR_SCREEN = 'hr_screen',
  TAKE_HOME = 'take_home',
  TECHNICAL = 'technical',
  SYSTEM_DESIGN = 'system_design',
  BEHAVIORAL = 'behavioral',
  HIRING_MANAGER = 'hiring_manager',
  ONSITE_LOOP = 'onsite_loop',
  FINAL = 'final',
  OTHER = 'other',
}
```

- [ ] **Step 1.9:** Create `src/modules/job-application/enums/interview-format.enum.ts`

```ts
export enum InterviewFormat {
  IN_PERSON = 'in_person',
  VIDEO = 'video',
  PHONE = 'phone',
}
```

- [ ] **Step 1.10:** Create `src/modules/job-application/enums/interview-outcome.enum.ts`

```ts
export enum InterviewOutcome {
  PENDING = 'pending',
  PASSED = 'passed',
  FAILED = 'failed',
  NO_SHOW = 'no_show',
  CANCELLED = 'cancelled',
}
```

- [ ] **Step 1.11:** Run `npm run build` and confirm zero errors.

---

### Task 2: Add new interface files (4 jsonb-shape interfaces)

- **path:** `src/modules/job-application/interfaces/{job-application-contact,job-application-attachment,job-application-status-history,job-application-compensation-offer}.interface.ts`
- **intent:** Document the shape of every new jsonb column/array so the entity, DTOs, and service share one source of truth and `any` is never used.
- **verify:** `npm run build` — expect zero errors. `grep -l "any" src/modules/job-application/interfaces/` should NOT match these new files.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `.ai/rules.md` (rule 13), `docs/CONVENTIONS.md` ("Type placement").

- [ ] **Step 2.1:** Create `src/modules/job-application/interfaces/job-application-contact.interface.ts`

```ts
export type JobApplicationContactRole =
  | 'recruiter'
  | 'hiring_manager'
  | 'interviewer'
  | 'referrer'
  | 'other';

export interface IJobApplicationContact {
  role: JobApplicationContactRole;
  name: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  notes?: string;
}
```

- [ ] **Step 2.2:** Create `src/modules/job-application/interfaces/job-application-attachment.interface.ts`

```ts
export type JobApplicationAttachmentKind =
  | 'job_description_snapshot'
  | 'offer_letter'
  | 'take_home_brief'
  | 'prep_notes'
  | 'cover_letter_pdf'
  | 'other';

export interface IJobApplicationAttachment {
  kind: JobApplicationAttachmentKind;
  label: string;
  url: string;
  uploaded_at: string;
}
```

- [ ] **Step 2.3:** Create `src/modules/job-application/interfaces/job-application-status-history.interface.ts`

```ts
import type { ApplicationStatus } from '../../../database/entities/job-application.entity';

export interface IJobApplicationStatusHistoryEntry {
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  changed_at: string;
  changed_by_user_id?: string;
  note?: string;
}
```

- [ ] **Step 2.4:** Create `src/modules/job-application/interfaces/job-application-compensation-offer.interface.ts`

```ts
import type { PayPeriod } from '../enums/pay-period.enum';

export interface IJobApplicationCompensationOffer {
  base_salary?: number;
  bonus_amount?: number;
  equity_value?: number;
  equity_notes?: string;
  sign_on_bonus?: number;
  total_comp?: number;
  currency?: string;
  pay_period?: PayPeriod;
  benefits_notes?: string;
  received_at?: string;
  decision_deadline?: string;
}
```

- [ ] **Step 2.5:** Run `npm run build` and confirm zero errors.

---

### Task 3: Extend `ApplicationStatus` enum (in entity file, in place)

- **path:** `src/database/entities/job-application.entity.ts:15-24`
- **intent:** Add `WISHLIST`, `INTERESTED`, `OFFER_DECLINED` so users can save-for-later and record offers they declined.
- **verify:** `npm run build` — expect zero errors. `grep -c "= '" src/database/entities/job-application.entity.ts` increases by 3 in the enum block.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `.ai/rules.md` ("Naming"), existing entity file lines 15–24.

- [ ] **Step 3.1:** Replace the `ApplicationStatus` enum body in `src/database/entities/job-application.entity.ts` with:

```ts
export enum ApplicationStatus {
  WISHLIST = 'wishlist',
  INTERESTED = 'interested',
  APPLIED = 'applied',
  SCREENING = 'screening',
  TECHNICAL_ROUND = 'technical_round',
  INTERVIEWED = 'interviewed',
  OFFER_RECEIVED = 'offer_received',
  ACCEPTED = 'accepted',
  OFFER_DECLINED = 'offer_declined',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
}
```

- [ ] **Step 3.2:** Run `npm run build`. Confirm no TypeScript errors. The Postgres enum in the DB does not yet contain the new values — that is added in Task 4.

---

### Task 4: Create migration `20260501000001-expand-job-application-fields.ts`

- **path:** `src/database/migrations/20260501000001-expand-job-application-fields.ts`
- **intent:** Add new ApplicationStatus enum values, rename `current_salary`→`salary_min` and `expected_salary`→`salary_max`, add all new top-level columns (currency/period, work mode, employment type, priority, tags, recruiter, hiring manager, applied_via, job_board_source, decision_deadline, next_action, rejection_stage, rejection_feedback_received, status_history, contacts, attachments, compensation_offer).
- **verify:** From repo root, run `npm run typeorm:run` (or whatever the project alias is — confirm via `package.json`). Then in Postgres: `\d job_applications` — every new column present, salary columns renamed. Run `npm run typeorm:revert` and confirm clean rollback. Then re-apply.
- **agency:** `subagentType: "Database Optimizer"` / `cursorRule: "@agency-database-optimizer.mdc"`
- **docs:** `docs/CONVENTIONS.md`, `.ai/rules.md` (rule 9 — no magic values), existing migration `src/database/migrations/20260430000001-add-prompt-version.ts` for style.

- [ ] **Step 4.1:** Inspect `package.json` to confirm migration commands.

```bash
grep -E '"typeorm:|"migration:' /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend/package.json
```

- [ ] **Step 4.2:** Create `src/database/migrations/20260501000001-expand-job-application-fields.ts` with the full content below.

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandJobApplicationFields20260501000001
  implements MigrationInterface
{
  name = 'ExpandJobApplicationFields20260501000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Extend ApplicationStatus enum (Postgres requires ALTER TYPE ADD VALUE).
    await queryRunner.query(
      `ALTER TYPE "public"."job_applications_status_enum" ADD VALUE IF NOT EXISTS 'wishlist' BEFORE 'applied'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."job_applications_status_enum" ADD VALUE IF NOT EXISTS 'interested' BEFORE 'applied'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."job_applications_status_enum" ADD VALUE IF NOT EXISTS 'offer_declined' AFTER 'accepted'`,
    );

    // 2) Rename salary columns.
    await queryRunner.query(
      `ALTER TABLE "job_applications" RENAME COLUMN "current_salary" TO "salary_min"`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" RENAME COLUMN "expected_salary" TO "salary_max"`,
    );

    // 3) New compensation metadata columns.
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "salary_currency" VARCHAR(3) NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_pay_period_enum" AS ENUM('annual','monthly','hourly')`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "pay_period" "public"."job_applications_pay_period_enum" NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "salary_negotiable" BOOLEAN NULL`,
    );

    // 4) New job-context enums + columns.
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_employment_type_enum" AS ENUM('full_time','part_time','contract','internship','freelance')`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "employment_type" "public"."job_applications_employment_type_enum" NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_work_mode_enum" AS ENUM('remote','hybrid','onsite')`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "work_mode" "public"."job_applications_work_mode_enum" NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_priority_enum" AS ENUM('low','medium','high','top_choice')`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "priority" "public"."job_applications_priority_enum" NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NULL`,
    );

    // 5) Sourcing + applied-via enums + columns.
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_job_board_source_enum" AS ENUM('linkedin','indeed','glassdoor','wellfound','company_site','referral','recruiter_outreach','other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "job_board_source" "public"."job_applications_job_board_source_enum" NULL`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_applied_via_enum" AS ENUM('easy_apply','company_portal','email','recruiter','referral','other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "applied_via" "public"."job_applications_applied_via_enum" NULL`,
    );

    // 6) Contact convenience columns.
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "recruiter_name" VARCHAR(200) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "recruiter_email" VARCHAR(200) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "recruiter_phone" VARCHAR(20) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "hiring_manager_name" VARCHAR(200) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "hiring_manager_email" VARCHAR(200) NULL`,
    );

    // 7) Action / deadline columns.
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "next_action" VARCHAR(500) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "decision_deadline" TIMESTAMP NULL`,
    );

    // 8) Rejection metadata.
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_rejection_stage_enum" AS ENUM('auto_rejected','after_screening','after_interview','after_offer_declined','other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "rejection_stage" "public"."job_applications_rejection_stage_enum" NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "rejection_feedback_received" BOOLEAN NULL`,
    );

    // 9) Structured jsonb additions.
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "status_history" JSONB NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "contacts" JSONB NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "attachments" JSONB NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "compensation_offer" JSONB NULL`,
    );

    // 10) Indexes for new filterable columns.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_job_applications_user_priority" ON "job_applications" ("user_id","priority")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_job_applications_user_work_mode" ON "job_applications" ("user_id","work_mode")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_job_applications_user_job_board_source" ON "job_applications" ("user_id","job_board_source")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_job_applications_user_decision_deadline" ON "job_applications" ("user_id","decision_deadline")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_job_applications_user_decision_deadline"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_job_applications_user_job_board_source"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_job_applications_user_work_mode"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_job_applications_user_priority"`,
    );

    // Drop new columns.
    const newCols = [
      'compensation_offer',
      'attachments',
      'contacts',
      'status_history',
      'rejection_feedback_received',
      'rejection_stage',
      'decision_deadline',
      'next_action',
      'hiring_manager_email',
      'hiring_manager_name',
      'recruiter_phone',
      'recruiter_email',
      'recruiter_name',
      'applied_via',
      'job_board_source',
      'tags',
      'priority',
      'work_mode',
      'employment_type',
      'salary_negotiable',
      'pay_period',
      'salary_currency',
    ];
    for (const col of newCols) {
      await queryRunner.query(
        `ALTER TABLE "job_applications" DROP COLUMN IF EXISTS "${col}"`,
      );
    }

    // Drop new enums.
    const newEnums = [
      'job_applications_rejection_stage_enum',
      'job_applications_applied_via_enum',
      'job_applications_job_board_source_enum',
      'job_applications_priority_enum',
      'job_applications_work_mode_enum',
      'job_applications_employment_type_enum',
      'job_applications_pay_period_enum',
    ];
    for (const enumName of newEnums) {
      await queryRunner.query(`DROP TYPE IF EXISTS "public"."${enumName}"`);
    }

    // Rename salary columns back.
    await queryRunner.query(
      `ALTER TABLE "job_applications" RENAME COLUMN "salary_max" TO "expected_salary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" RENAME COLUMN "salary_min" TO "current_salary"`,
    );

    // Note: Postgres cannot DROP VALUE from an enum without a destructive recreation.
    // The new ApplicationStatus values (wishlist/interested/offer_declined) are left in place;
    // any rows holding those values will block forward-migration testing on a re-run.
    // If a true rollback is needed, recreate the enum manually with only the original 8 values.
  }
}
```

- [ ] **Step 4.3:** Run the migration locally:

```bash
npm run typeorm:run   # or the project's actual migration alias from package.json
```

Expect: completes with no errors. Connect to the dev DB and run `\d job_applications` (psql) — confirm: `salary_min`, `salary_max`, `salary_currency`, `pay_period`, `salary_negotiable`, `employment_type`, `work_mode`, `priority`, `tags`, `job_board_source`, `applied_via`, `recruiter_name`, `recruiter_email`, `recruiter_phone`, `hiring_manager_name`, `hiring_manager_email`, `next_action`, `decision_deadline`, `rejection_stage`, `rejection_feedback_received`, `status_history`, `contacts`, `attachments`, `compensation_offer` are all present.

- [ ] **Step 4.4:** Test rollback round-trip on a scratch DB only (skip on shared dev): `npm run typeorm:revert`, then re-apply with `npm run typeorm:run`. The revert leaves new enum values on `job_applications_status_enum` — that's documented in the down() comment.

---

### Task 5: Update `JobApplication` entity to mirror new schema

- **path:** `src/database/entities/job-application.entity.ts`
- **intent:** Reflect renamed/added columns in TypeORM mapping; import enums from new files; type jsonb columns with the new interfaces.
- **verify:** `npm run build` — zero errors. `grep -n "current_salary\|expected_salary" src/database/entities/job-application.entity.ts` — zero matches.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/CONVENTIONS.md` ("Entity"), `.ai/rules.md` (rule 13).

- [ ] **Step 5.1:** Open `src/database/entities/job-application.entity.ts`. Replace the entire file content with the version below (keeps `ApplicationStatus`/`ApplicationSource` definitions in place to avoid an import-rewrite blast radius across unrelated modules):

```ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { ResumeGeneration } from './resume-generations.entity';
import { AtsMatchHistory } from './ats-match-history.entity';
import { JobBoardSource } from '../../modules/job-application/enums/job-board-source.enum';
import { AppliedVia } from '../../modules/job-application/enums/applied-via.enum';
import { EmploymentType } from '../../modules/job-application/enums/employment-type.enum';
import { WorkMode } from '../../modules/job-application/enums/work-mode.enum';
import { PayPeriod } from '../../modules/job-application/enums/pay-period.enum';
import { ApplicationPriority } from '../../modules/job-application/enums/application-priority.enum';
import { RejectionStage } from '../../modules/job-application/enums/rejection-stage.enum';
import type { IJobApplicationContact } from '../../modules/job-application/interfaces/job-application-contact.interface';
import type { IJobApplicationAttachment } from '../../modules/job-application/interfaces/job-application-attachment.interface';
import type { IJobApplicationStatusHistoryEntry } from '../../modules/job-application/interfaces/job-application-status-history.interface';
import type { IJobApplicationCompensationOffer } from '../../modules/job-application/interfaces/job-application-compensation-offer.interface';

export enum ApplicationStatus {
  WISHLIST = 'wishlist',
  INTERESTED = 'interested',
  APPLIED = 'applied',
  SCREENING = 'screening',
  TECHNICAL_ROUND = 'technical_round',
  INTERVIEWED = 'interviewed',
  OFFER_RECEIVED = 'offer_received',
  ACCEPTED = 'accepted',
  OFFER_DECLINED = 'offer_declined',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
}

export enum ApplicationSource {
  DIRECT_APPLY = 'direct_apply',
  TAILORED_RESUME = 'tailored_resume',
}

@Entity({ name: 'job_applications' })
@Index(['user_id', 'status', 'created_at'])
@Index(['user_id', 'company_name'])
@Index(['user_id', 'application_deadline'])
@Index(['user_id', 'priority'])
@Index(['user_id', 'work_mode'])
@Index(['user_id', 'job_board_source'])
@Index(['user_id', 'decision_deadline'])
@Index(['status', 'created_at'])
export class JobApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  user_id: string;

  // ── Job details ─────────────────────────────────────────────
  @Column({ type: 'varchar', length: 200 })
  company_name: string;

  @Column({ type: 'varchar', length: 300 })
  job_position: string;

  @Column({ type: 'text', nullable: true })
  job_description: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  job_url: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  job_location: string;

  @Column({ type: 'enum', enum: EmploymentType, nullable: true })
  employment_type: EmploymentType;

  @Column({ type: 'enum', enum: WorkMode, nullable: true })
  work_mode: WorkMode;

  // ── Compensation (posted) ───────────────────────────────────
  @Column({
    name: 'salary_min',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  salary_min: number;

  @Column({
    name: 'salary_max',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  salary_max: number;

  @Column({ type: 'varchar', length: 3, nullable: true })
  salary_currency: string;

  @Column({ type: 'enum', enum: PayPeriod, nullable: true })
  pay_period: PayPeriod;

  @Column({ type: 'boolean', nullable: true })
  salary_negotiable: boolean;

  // ── Pipeline state ──────────────────────────────────────────
  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.APPLIED,
  })
  status: ApplicationStatus;

  @Column({ type: 'enum', enum: ApplicationSource })
  application_source: ApplicationSource;

  @Column({ type: 'enum', enum: JobBoardSource, nullable: true })
  job_board_source: JobBoardSource;

  @Column({ type: 'enum', enum: AppliedVia, nullable: true })
  applied_via: AppliedVia;

  @Column({ type: 'enum', enum: ApplicationPriority, nullable: true })
  priority: ApplicationPriority;

  @Column({ type: 'text', array: true, nullable: true })
  tags: string[];

  @Column({ type: 'timestamp', nullable: true })
  application_deadline: Date;

  @Column({ type: 'timestamp', nullable: true })
  applied_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  decision_deadline: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  next_action: string;

  // ── ATS & resume data (unchanged) ───────────────────────────
  @Column({ type: 'float', nullable: true })
  ats_score: number;

  @Column({ type: 'jsonb', nullable: true })
  ats_analysis: any;

  @Column({ type: 'varchar', nullable: true })
  ats_match_history_id: string;

  @Column({ type: 'uuid', nullable: true })
  resume_generation_id: string;

  @Column({ type: 'text', nullable: true })
  resume_content: string;

  // ── Contacts (top-level convenience + jsonb extension) ──────
  @Column({ type: 'varchar', length: 200, nullable: true })
  recruiter_name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  recruiter_email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  recruiter_phone: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  hiring_manager_name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  hiring_manager_email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  contact_phone: string;

  @Column({ type: 'jsonb', nullable: true })
  contacts: IJobApplicationContact[];

  // ── Notes & narrative ───────────────────────────────────────
  @Column({ type: 'text', nullable: true })
  cover_letter: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  // ── Interview & follow-up (single-event quick fields kept; multi-round in child table) ──
  @Column({ type: 'timestamp', nullable: true })
  interview_scheduled_at: Date;

  @Column({ type: 'text', nullable: true })
  interview_notes: string;

  @Column({ type: 'timestamp', nullable: true })
  follow_up_date: Date;

  // ── Rejection ───────────────────────────────────────────────
  @Column({ type: 'enum', enum: RejectionStage, nullable: true })
  rejection_stage: RejectionStage;

  @Column({ type: 'text', nullable: true })
  rejection_reason: string;

  @Column({ type: 'boolean', nullable: true })
  rejection_feedback_received: boolean;

  // ── Offer (structured jsonb) ────────────────────────────────
  @Column({ type: 'jsonb', nullable: true })
  compensation_offer: IJobApplicationCompensationOffer;

  // ── Attachments / status timeline / metadata ────────────────
  @Column({ type: 'jsonb', nullable: true })
  attachments: IJobApplicationAttachment[];

  @Column({ type: 'jsonb', nullable: true })
  status_history: IJobApplicationStatusHistoryEntry[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    skills_matched?: string[];
    skills_missing?: string[];
    application_method?: string;
    referral_source?: string;
    response_time?: number;
    interview_rounds?: number;
    [key: string]: any;
  };

  // ── System ──────────────────────────────────────────────────
  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ── Relations ───────────────────────────────────────────────
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => ResumeGeneration, { nullable: true })
  @JoinColumn({ name: 'resume_generation_id' })
  resume_generation: ResumeGeneration;

  @ManyToOne(() => AtsMatchHistory, { nullable: true })
  @JoinColumn({ name: 'ats_match_history_id' })
  ats_match_history: AtsMatchHistory;
}
```

- [ ] **Step 5.2:** Run `npm run build`. The build will surface every callsite that still uses `current_salary` / `expected_salary`. Fix those in Task 6 onward.

---

### Task 6: Create `JobApplicationInterview` entity

- **path:** `src/database/entities/job-application-interview.entity.ts`
- **intent:** Model multi-round interview events with stage, format, outcome, scheduled/completed timestamps, interviewer info, and notes.
- **verify:** `npm run build` — zero errors.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/CONVENTIONS.md` ("Entity"), existing entity files for style.

- [ ] **Step 6.1:** Create the file:

```ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { JobApplication } from './job-application.entity';
import { InterviewStage } from '../../modules/job-application/enums/interview-stage.enum';
import { InterviewFormat } from '../../modules/job-application/enums/interview-format.enum';
import { InterviewOutcome } from '../../modules/job-application/enums/interview-outcome.enum';

@Entity({ name: 'job_application_interviews' })
@Index(['job_application_id', 'scheduled_at'])
export class JobApplicationInterview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  job_application_id: string;

  @Column({ type: 'enum', enum: InterviewStage })
  stage: InterviewStage;

  @Column({ type: 'enum', enum: InterviewFormat, nullable: true })
  format: InterviewFormat;

  @Column({
    type: 'enum',
    enum: InterviewOutcome,
    default: InterviewOutcome.PENDING,
  })
  outcome: InterviewOutcome;

  @Column({ type: 'timestamp', nullable: true })
  scheduled_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  completed_at: Date;

  @Column({ type: 'integer', nullable: true })
  duration_minutes: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  interviewer_name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  interviewer_email: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  location_or_link: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => JobApplication, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_application_id' })
  job_application: JobApplication;
}
```

- [ ] **Step 6.2:** Run `npm run build` — zero errors.

---

### Task 7: Create migration `20260501000002-create-job-application-interviews.ts`

- **path:** `src/database/migrations/20260501000002-create-job-application-interviews.ts`
- **intent:** Provision the `job_application_interviews` table + enums + FK + index.
- **verify:** `npm run typeorm:run` — clean apply. `\d job_application_interviews` in psql shows columns + FK on delete cascade.
- **agency:** `subagentType: "Database Optimizer"` / `cursorRule: "@agency-database-optimizer.mdc"`
- **docs:** `docs/CONVENTIONS.md`, prior migrations for style.

- [ ] **Step 7.1:** Create the migration:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJobApplicationInterviews20260501000002
  implements MigrationInterface
{
  name = 'CreateJobApplicationInterviews20260501000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."job_application_interviews_stage_enum" AS ENUM('recruiter_screen','hr_screen','take_home','technical','system_design','behavioral','hiring_manager','onsite_loop','final','other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_application_interviews_format_enum" AS ENUM('in_person','video','phone')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_application_interviews_outcome_enum" AS ENUM('pending','passed','failed','no_show','cancelled')`,
    );

    await queryRunner.query(`
      CREATE TABLE "job_application_interviews" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "job_application_id" uuid NOT NULL,
        "stage" "public"."job_application_interviews_stage_enum" NOT NULL,
        "format" "public"."job_application_interviews_format_enum",
        "outcome" "public"."job_application_interviews_outcome_enum" NOT NULL DEFAULT 'pending',
        "scheduled_at" TIMESTAMP,
        "completed_at" TIMESTAMP,
        "duration_minutes" INTEGER,
        "interviewer_name" VARCHAR(200),
        "interviewer_email" VARCHAR(200),
        "location_or_link" VARCHAR(500),
        "notes" TEXT,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_application_interviews" PRIMARY KEY ("id"),
        CONSTRAINT "FK_job_application_interviews_job_application"
          FOREIGN KEY ("job_application_id")
          REFERENCES "job_applications"("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_job_application_interviews_app_scheduled" ON "job_application_interviews" ("job_application_id","scheduled_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_job_application_interviews_app_scheduled"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "job_application_interviews"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."job_application_interviews_outcome_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."job_application_interviews_format_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."job_application_interviews_stage_enum"`,
    );
  }
}
```

- [ ] **Step 7.2:** Run `npm run typeorm:run`. Verify with `\d job_application_interviews`.

---

### Task 8: Update `CreateJobApplicationDto`

- **path:** `src/modules/job-application/dtos/job-application.dto.ts` (CreateJobApplicationDto class)
- **intent:** Accept every new field on create. Make `job_description` optional. Add validators that import enums from new files. Surface Swagger metadata for each new field.
- **verify:** `npm run build` clean. POST `/job-applications` with a payload containing all new fields succeeds (smoke test in Task 22).
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/CONVENTIONS.md` ("Validation"), `docs/API-PATTERNS.md` ("Request validation"), `.ai/rules.md` (rule 11, rule 12).

- [ ] **Step 8.1:** Replace the `CreateJobApplicationDto` block in `src/modules/job-application/dtos/job-application.dto.ts` with the version below. (Leave `UpdateJobApplicationDto` for Task 9 — keep file editing focused.)

```ts
export class CreateJobApplicationDto {
  @IsEnum(ApplicationSource, {
    message: 'Application source must be either direct_apply or tailored_resume',
  })
  application_source: ApplicationSource;

  @IsOptional()
  @IsEnum(ApplicationStatus, { message: 'status must be a valid ApplicationStatus' })
  status?: ApplicationStatus;

  @IsString({ message: 'Company name must be a string' })
  @IsNotEmpty({ message: 'Company name is required' })
  @TrimString()
  company_name: string;

  @IsString({ message: 'Job position must be a string' })
  @IsNotEmpty({ message: 'Job position is required' })
  @TrimString()
  job_position: string;

  @IsOptional()
  @IsString({ message: 'Job description must be a string' })
  @TrimString()
  job_description?: string;

  @IsOptional()
  @IsString()
  resume_generation_id?: string;

  @ApiPropertyOptional({
    description:
      'When the candidate applied (ISO 8601). Omit for wishlist/interested. Required for tailored_resume to default to now().',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Applied date must be a valid ISO date string' })
  applied_at?: string;

  @IsOptional()
  @IsString()
  resume_content?: string;

  @IsOptional()
  @IsString()
  @IsUrl({}, { message: 'Job URL must be a valid URL' })
  job_url?: string;

  @IsOptional()
  @IsString()
  job_location?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employment_type?: EmploymentType;

  @IsOptional()
  @IsEnum(WorkMode)
  work_mode?: WorkMode;

  @IsOptional()
  @IsNumber({}, { message: 'salary_min must be a number' })
  @Min(0, { message: 'salary_min must be at least 0' })
  salary_min?: number;

  @IsOptional()
  @IsNumber({}, { message: 'salary_max must be a number' })
  @Min(0, { message: 'salary_max must be at least 0' })
  salary_max?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3, { message: 'salary_currency must be a 3-letter ISO 4217 code' })
  salary_currency?: string;

  @IsOptional()
  @IsEnum(PayPeriod)
  pay_period?: PayPeriod;

  @IsOptional()
  @IsBoolean()
  salary_negotiable?: boolean;

  @IsOptional()
  @IsEnum(JobBoardSource)
  job_board_source?: JobBoardSource;

  @IsOptional()
  @IsEnum(AppliedVia)
  applied_via?: AppliedVia;

  @IsOptional()
  @IsEnum(ApplicationPriority)
  priority?: ApplicationPriority;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsDateString({}, { message: 'application_deadline must be a valid date' })
  application_deadline?: string;

  @IsOptional()
  @IsDateString({}, { message: 'decision_deadline must be a valid date' })
  decision_deadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  next_action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  recruiter_name?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  recruiter_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  recruiter_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  hiring_manager_name?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  hiring_manager_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'Cover letter is too long (maximum 5,000 characters)' })
  cover_letter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Notes are too long (maximum 2,000 characters)' })
  notes?: string;

  @IsOptional()
  @IsArray()
  contacts?: IJobApplicationContact[];

  @IsOptional()
  @IsArray()
  attachments?: IJobApplicationAttachment[];

  @IsOptional()
  @IsObject()
  metadata?: any;
}
```

- [ ] **Step 8.2:** Update the imports at the top of the file to include every new enum + `IsBoolean`, `IsArray`, `ArrayMaxSize`, `IsEmail` from `class-validator`, plus the two contact/attachment interfaces. Run `npm run build` — zero errors.

---

### Task 9: Update `UpdateJobApplicationDto` to allow editing every core field

- **path:** `src/modules/job-application/dtos/job-application.dto.ts` (UpdateJobApplicationDto class)
- **intent:** Fix the **#1 reported gap** — the sidebar can now edit every field a job seeker realistically wants to update (company_name, job_position, job_description, urls, location, salary, employment type, work mode, priority, tags, deadlines, recruiter/HM fields, rejection details, offer comp, attachments, contacts).
- **verify:** `npm run build` clean. PUT `/job-applications/:id` with each field individually updates only that field (smoke test in Task 22).
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/API-PATTERNS.md`, `.ai/rules.md` (rule 11, rule 12).

- [ ] **Step 9.1:** Replace the `UpdateJobApplicationDto` block. Every field is optional; semantics: PATCH-style partial update. Note `compensation_offer` is the structured-jsonb interface.

```ts
export class UpdateJobApplicationDto {
  // ── Core job (newly editable) ──────────────────────────────
  @IsOptional() @IsString() @MaxLength(200) @TrimString()
  company_name?: string;

  @IsOptional() @IsString() @MaxLength(300) @TrimString()
  job_position?: string;

  @IsOptional() @IsString() @TrimString()
  job_description?: string;

  @IsOptional() @IsString() @IsUrl() job_url?: string;
  @IsOptional() @IsString() job_location?: string;
  @IsOptional() @IsEnum(EmploymentType) employment_type?: EmploymentType;
  @IsOptional() @IsEnum(WorkMode) work_mode?: WorkMode;

  // ── Compensation (posted) ──────────────────────────────────
  @IsOptional() @IsNumber() @Min(0) salary_min?: number;
  @IsOptional() @IsNumber() @Min(0) salary_max?: number;
  @IsOptional() @IsString() @MaxLength(3) salary_currency?: string;
  @IsOptional() @IsEnum(PayPeriod) pay_period?: PayPeriod;
  @IsOptional() @IsBoolean() salary_negotiable?: boolean;

  // ── Pipeline ───────────────────────────────────────────────
  @IsOptional() @IsEnum(ApplicationStatus) status?: ApplicationStatus;
  @IsOptional() @IsEnum(JobBoardSource) job_board_source?: JobBoardSource;
  @IsOptional() @IsEnum(AppliedVia) applied_via?: AppliedVia;
  @IsOptional() @IsEnum(ApplicationPriority) priority?: ApplicationPriority;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional() @IsDateString() applied_at?: string;
  @IsOptional() @IsDateString() application_deadline?: string;
  @IsOptional() @IsDateString() decision_deadline?: string;
  @IsOptional() @IsString() @MaxLength(500) next_action?: string;

  // ── Contacts ───────────────────────────────────────────────
  @IsOptional() @IsString() @MaxLength(200) recruiter_name?: string;
  @IsOptional() @IsString() @IsEmail() recruiter_email?: string;
  @IsOptional() @IsString() @MaxLength(20) recruiter_phone?: string;
  @IsOptional() @IsString() @MaxLength(200) hiring_manager_name?: string;
  @IsOptional() @IsString() @IsEmail() hiring_manager_email?: string;
  @IsOptional() @IsString() @MaxLength(20) contact_phone?: string;
  @IsOptional() @IsArray() contacts?: IJobApplicationContact[];

  // ── Notes / interview / follow-up ──────────────────────────
  @IsOptional() @IsString() @MaxLength(5000) cover_letter?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsDateString() interview_scheduled_at?: string;
  @IsOptional() @IsString() @MaxLength(2000) interview_notes?: string;
  @IsOptional() @IsDateString() follow_up_date?: string;

  // ── Rejection ──────────────────────────────────────────────
  @IsOptional() @IsEnum(RejectionStage) rejection_stage?: RejectionStage;
  @IsOptional() @IsString() @MaxLength(1000) rejection_reason?: string;
  @IsOptional() @IsBoolean() rejection_feedback_received?: boolean;

  // ── Offer ──────────────────────────────────────────────────
  @IsOptional() @IsObject() compensation_offer?: IJobApplicationCompensationOffer;

  // ── Attachments / open metadata ────────────────────────────
  @IsOptional() @IsArray() attachments?: IJobApplicationAttachment[];
  @IsOptional() @IsObject() metadata?: any;
}
```

- [ ] **Step 9.2:** Run `npm run build`.

---

### Task 10: Update `JobApplicationResponseDto`

- **path:** `src/modules/job-application/dtos/job-application-response.dto.ts`
- **intent:** Surface every new top-level column and structured jsonb in the response shape, with Swagger annotations.
- **verify:** `npm run build` clean; `npm run start:dev` and visit `/api` (Swagger UI) — confirm new fields documented under `JobApplicationResponseDto`.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/API-PATTERNS.md`.

- [ ] **Step 10.1:** Add the following property declarations to `JobApplicationResponseDto` (after the existing `expected_salary` slot, which is being replaced by `salary_min` / `salary_max`):

```ts
  @ApiPropertyOptional({ description: 'Minimum advertised salary' })
  salary_min?: number;

  @ApiPropertyOptional({ description: 'Maximum advertised salary' })
  salary_max?: number;

  @ApiPropertyOptional({ description: 'ISO 4217 currency code (e.g. USD, EUR, PKR)' })
  salary_currency?: string;

  @ApiPropertyOptional({ description: 'Pay period', enum: PayPeriod })
  pay_period?: PayPeriod;

  @ApiPropertyOptional() salary_negotiable?: boolean;

  @ApiPropertyOptional({ enum: EmploymentType }) employment_type?: EmploymentType;
  @ApiPropertyOptional({ enum: WorkMode }) work_mode?: WorkMode;
  @ApiPropertyOptional({ enum: JobBoardSource }) job_board_source?: JobBoardSource;
  @ApiPropertyOptional({ enum: AppliedVia }) applied_via?: AppliedVia;
  @ApiPropertyOptional({ enum: ApplicationPriority }) priority?: ApplicationPriority;
  @ApiPropertyOptional({ type: [String] }) tags?: string[];

  @ApiPropertyOptional() decision_deadline?: Date;
  @ApiPropertyOptional() next_action?: string;

  @ApiPropertyOptional() recruiter_name?: string;
  @ApiPropertyOptional() recruiter_email?: string;
  @ApiPropertyOptional() recruiter_phone?: string;
  @ApiPropertyOptional() hiring_manager_name?: string;
  @ApiPropertyOptional() hiring_manager_email?: string;
  @ApiPropertyOptional({ type: 'array' }) contacts?: IJobApplicationContact[];

  @ApiPropertyOptional({ enum: RejectionStage }) rejection_stage?: RejectionStage;
  @ApiPropertyOptional() rejection_feedback_received?: boolean;

  @ApiPropertyOptional({ description: 'Structured offer compensation' })
  compensation_offer?: IJobApplicationCompensationOffer;

  @ApiPropertyOptional({ type: 'array' }) attachments?: IJobApplicationAttachment[];
  @ApiPropertyOptional({ type: 'array' }) status_history?: IJobApplicationStatusHistoryEntry[];
```

- [ ] **Step 10.2:** **Remove** `current_salary` and `expected_salary` properties from `JobApplicationResponseDto` (lines 41–49 of the original file).

- [ ] **Step 10.3:** Update imports for the new enums and interfaces. Run `npm run build`.

---

### Task 11: Update domain interfaces (`ICreateJobApplication`, `IUpdateJobApplication`, `IJobApplicationQuery`)

- **path:** `src/modules/job-application/interfaces/job-application.interface.ts`
- **intent:** Match the new DTOs so the service layer is type-checked end-to-end.
- **verify:** `npm run build` clean — every callsite updated.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `.ai/rules.md` (rule 13).

- [ ] **Step 11.1:** Replace the file with:

```ts
import {
  ApplicationStatus,
  ApplicationSource,
  JobApplication,
} from '../../../database/entities/job-application.entity';
import { JobBoardSource } from '../enums/job-board-source.enum';
import { AppliedVia } from '../enums/applied-via.enum';
import { EmploymentType } from '../enums/employment-type.enum';
import { WorkMode } from '../enums/work-mode.enum';
import { PayPeriod } from '../enums/pay-period.enum';
import { ApplicationPriority } from '../enums/application-priority.enum';
import { RejectionStage } from '../enums/rejection-stage.enum';
import type { IJobApplicationContact } from './job-application-contact.interface';
import type { IJobApplicationAttachment } from './job-application-attachment.interface';
import type { IJobApplicationStatusHistoryEntry } from './job-application-status-history.interface';
import type { IJobApplicationCompensationOffer } from './job-application-compensation-offer.interface';

export interface IJobApplicationMetadata {
  skills_matched?: string[];
  skills_missing?: string[];
  [key: string]: any;
}

export interface ICreateJobApplication {
  user_id?: string;
  application_source: ApplicationSource;
  status?: ApplicationStatus;
  company_name: string;
  job_position: string;
  job_description?: string;
  job_url?: string;
  job_location?: string;
  employment_type?: EmploymentType;
  work_mode?: WorkMode;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  pay_period?: PayPeriod;
  salary_negotiable?: boolean;
  job_board_source?: JobBoardSource;
  applied_via?: AppliedVia;
  priority?: ApplicationPriority;
  tags?: string[];
  applied_at?: string;
  application_deadline?: Date | string;
  decision_deadline?: Date | string;
  next_action?: string;
  resume_generation_id?: string;
  resume_content?: string;
  recruiter_name?: string;
  recruiter_email?: string;
  recruiter_phone?: string;
  hiring_manager_name?: string;
  hiring_manager_email?: string;
  contact_phone?: string;
  contacts?: IJobApplicationContact[];
  cover_letter?: string;
  notes?: string;
  attachments?: IJobApplicationAttachment[];
  metadata?: IJobApplicationMetadata;
}

export interface IUpdateJobApplication {
  company_name?: string;
  job_position?: string;
  job_description?: string;
  job_url?: string;
  job_location?: string;
  employment_type?: EmploymentType;
  work_mode?: WorkMode;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  pay_period?: PayPeriod;
  salary_negotiable?: boolean;
  status?: ApplicationStatus;
  job_board_source?: JobBoardSource;
  applied_via?: AppliedVia;
  priority?: ApplicationPriority;
  tags?: string[];
  applied_at?: Date | string;
  application_deadline?: Date | string;
  decision_deadline?: Date | string;
  next_action?: string;
  recruiter_name?: string;
  recruiter_email?: string;
  recruiter_phone?: string;
  hiring_manager_name?: string;
  hiring_manager_email?: string;
  contact_phone?: string;
  contacts?: IJobApplicationContact[];
  cover_letter?: string;
  notes?: string;
  interview_scheduled_at?: Date | string;
  interview_notes?: string;
  follow_up_date?: Date | string;
  rejection_stage?: RejectionStage;
  rejection_reason?: string;
  rejection_feedback_received?: boolean;
  compensation_offer?: IJobApplicationCompensationOffer;
  attachments?: IJobApplicationAttachment[];
  metadata?: IJobApplicationMetadata;
}

export interface IJobApplicationQuery {
  user_id?: string;
  status?: ApplicationStatus;
  statuses?: ApplicationStatus[];
  company_name?: string;
  q?: string;
  job_board_source?: JobBoardSource;
  work_mode?: WorkMode;
  employment_type?: EmploymentType;
  priority?: ApplicationPriority;
  tag?: string;
  applied_at_from?: string;
  applied_at_to?: string;
  deadline_from?: string;
  deadline_to?: string;
  follow_up_from?: string;
  follow_up_to?: string;
  decision_deadline_from?: string;
  decision_deadline_to?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: 'ASC' | 'DESC';
  fields?: string[];
}

export interface IJobApplicationStats {
  total_applications: number;
  applications_by_status: Record<ApplicationStatus, number>;
  response_rate: number;
  interview_rate: number;
  success_rate: number;
  top_companies: Array<{ company_name: string; application_count: number }>;
  monthly_trend: Array<{ month: string; count: number }>;
}

export interface IJobApplicationWithRelations extends JobApplication {
  resumeGeneration?: {
    id: string;
    template_id: string;
    tailored_content: any;
  };
}
```

- [ ] **Step 11.2:** Run `npm run build`.

---

### Task 12: Add filter handling in `JobApplicationQueryDto` and the service query builder

- **path:** `src/modules/job-application/dtos/job-application-query.dto.ts`, `src/modules/job-application/job-application.service.ts:426-496` (buildJobApplicationQuery)
- **intent:** Surface the new filter dimensions (`work_mode`, `employment_type`, `priority`, `job_board_source`, `tag`, `decision_deadline_from/_to`) in the list endpoint.
- **verify:** `npm run build` clean. `GET /job-applications?work_mode=remote&priority=top_choice&tag=remote-only` — query builder appends WHERE clauses (verify in logs).
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/API-PATTERNS.md`, existing `buildJobApplicationQuery` for style.

- [ ] **Step 12.1:** Open `src/modules/job-application/dtos/job-application-query.dto.ts`, add the new filter fields with `@IsOptional()` and the appropriate enum/string validators (mirroring the `IJobApplicationQuery` extension from Task 11).

- [ ] **Step 12.2:** In `job-application.service.ts:buildJobApplicationQuery`, add (after the existing filters, before the date-range block):

```ts
if (query.job_board_source) {
  queryBuilder.andWhere('jobApplication.job_board_source = :jbs', {
    jbs: query.job_board_source,
  });
}
if (query.work_mode) {
  queryBuilder.andWhere('jobApplication.work_mode = :wm', {
    wm: query.work_mode,
  });
}
if (query.employment_type) {
  queryBuilder.andWhere('jobApplication.employment_type = :et', {
    et: query.employment_type,
  });
}
if (query.priority) {
  queryBuilder.andWhere('jobApplication.priority = :pri', {
    pri: query.priority,
  });
}
if (query.tag) {
  queryBuilder.andWhere(':tag = ANY(jobApplication.tags)', {
    tag: query.tag,
  });
}
```

Then reuse `appendNullableDateRange` for `decision_deadline_from/_to`.

- [ ] **Step 12.3:** Add `decision_deadline`, `priority`, `work_mode`, `employment_type`, `job_board_source` to the `JOB_APPLICATION_LIST_SORT_COLUMNS` set so they can be sorted on.

- [ ] **Step 12.4:** Run `npm run build`.

---

### Task 13: Update `field-selection.config.ts`

- **path:** `src/modules/job-application/config/field-selection.config.ts`
- **intent:** Allow sparse-fields requests to include every new column.
- **verify:** `npm run build` clean. `GET /job-applications?fields=id,salary_min,salary_max,salary_currency,priority,tags` returns only those fields.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/specs/09-api-conventions.md` (sparse fields), existing config for style.

- [ ] **Step 13.1:** Replace the file content's `allowedFields` array with:

```ts
allowedFields: [
  'id',
  'company_name',
  'job_position',
  'job_description',
  'job_url',
  'job_location',
  'employment_type',
  'work_mode',
  'salary_min',
  'salary_max',
  'salary_currency',
  'pay_period',
  'salary_negotiable',
  'status',
  'application_source',
  'job_board_source',
  'applied_via',
  'priority',
  'tags',
  'application_deadline',
  'applied_at',
  'decision_deadline',
  'next_action',
  'cover_letter',
  'notes',
  'recruiter_name',
  'recruiter_email',
  'recruiter_phone',
  'hiring_manager_name',
  'hiring_manager_email',
  'contact_phone',
  'contacts',
  'interview_scheduled_at',
  'interview_notes',
  'follow_up_date',
  'rejection_stage',
  'rejection_reason',
  'rejection_feedback_received',
  'compensation_offer',
  'attachments',
  'status_history',
  'metadata',
  'created_at',
  'updated_at',
  'user_id',
],
```

- [ ] **Step 13.2:** Run `npm run build`.

---

### Task 14: Add status-history helper

- **path:** `src/modules/job-application/services/job-application-status-history.helper.ts`
- **intent:** Pure function that, given the previous and incoming application, returns an updated `status_history` array with a new entry **only when status changed**. Keeps service code <50 LOC per function.
- **verify:** `npm run build` clean. Function imported in service compiles.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `.ai/rules.md` ("Style — max 50 lines per function").

- [ ] **Step 14.1:** Create the file:

```ts
import type { JobApplication } from '../../../database/entities/job-application.entity';
import type { ApplicationStatus } from '../../../database/entities/job-application.entity';
import type { IJobApplicationStatusHistoryEntry } from '../interfaces/job-application-status-history.interface';

export function appendStatusHistoryIfChanged(
  previous: JobApplication,
  incomingStatus: ApplicationStatus | undefined,
  changedByUserId: string | undefined,
): IJobApplicationStatusHistoryEntry[] {
  const existing = previous.status_history ?? [];
  if (!incomingStatus || incomingStatus === previous.status) {
    return existing;
  }
  const entry: IJobApplicationStatusHistoryEntry = {
    from: previous.status ?? null,
    to: incomingStatus,
    changed_at: new Date().toISOString(),
    changed_by_user_id: changedByUserId,
  };
  return [...existing, entry];
}
```

- [ ] **Step 14.2:** Run `npm run build`.

---

### Task 15: Update `JobApplicationService.createJobApplication` and `updateJobApplication`

- **path:** `src/modules/job-application/job-application.service.ts:84-140` (create) and `:275-316` (update)
- **intent:** (a) Persist every new field on create, (b) seed `status_history` with the initial state, (c) merge instead of overwrite `metadata` on update, (d) call the helper to append a `status_history` entry whenever status changes, (e) preserve the existing salary→salary_min/max naming.
- **verify:** `npm run build` clean. Manual smoke test in Task 22 confirms behavior end-to-end.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/CONVENTIONS.md` (Service layer), `.ai/rules.md` ("Anti-patterns" — no logic in controllers).

- [ ] **Step 15.1:** Replace the body of `createJobApplication` so the entity creation block reads (only the changed segment shown):

```ts
const initialStatus = data.status ?? ApplicationStatus.APPLIED;
const initialHistory: IJobApplicationStatusHistoryEntry[] = [
  {
    from: null,
    to: initialStatus,
    changed_at: new Date().toISOString(),
    changed_by_user_id: data.user_id,
  },
];

const jobApplication = this.jobApplicationRepository.create({
  user_id: data.user_id,
  company_name: data.company_name,
  job_position: data.job_position,
  job_description: data.job_description,
  application_source: data.application_source,
  status: initialStatus,
  applied_at: resolveAppliedAtOnCreate(data),
  resume_generation_id: data.resume_generation_id,
  resume_content: data.resume_content,
  job_url: data.job_url,
  job_location: data.job_location,
  employment_type: data.employment_type,
  work_mode: data.work_mode,
  salary_min: data.salary_min,
  salary_max: data.salary_max,
  salary_currency: data.salary_currency,
  pay_period: data.pay_period,
  salary_negotiable: data.salary_negotiable,
  job_board_source: data.job_board_source,
  applied_via: data.applied_via,
  priority: data.priority,
  tags: data.tags,
  application_deadline: data.application_deadline
    ? new Date(data.application_deadline as string)
    : undefined,
  decision_deadline: data.decision_deadline
    ? new Date(data.decision_deadline as string)
    : undefined,
  next_action: data.next_action,
  recruiter_name: data.recruiter_name,
  recruiter_email: data.recruiter_email,
  recruiter_phone: data.recruiter_phone,
  hiring_manager_name: data.hiring_manager_name,
  hiring_manager_email: data.hiring_manager_email,
  contact_phone: data.contact_phone,
  contacts: data.contacts,
  cover_letter: data.cover_letter,
  notes: data.notes,
  attachments: data.attachments,
  status_history: initialHistory,
  metadata: this.buildJobApplicationMetadata(data.metadata, data.resume_content),
});
```

- [ ] **Step 15.2:** Replace the body of `updateJobApplication` with:

```ts
async updateJobApplication(
  id: string,
  data: IUpdateJobApplication,
  userContext: { userId?: string },
): Promise<JobApplication> {
  try {
    this.logger.log(`Updating job application with ID: ${id}`);
    const application = await this.getJobApplicationById(id, userContext);

    const nextStatusHistory = appendStatusHistoryIfChanged(
      application,
      data.status,
      userContext.userId,
    );

    const mergedMetadata = data.metadata
      ? { ...(application.metadata ?? {}), ...data.metadata }
      : application.metadata;

    const dateFields: Partial<JobApplication> = {};
    if (data.applied_at) dateFields.applied_at = new Date(data.applied_at as string);
    if (data.application_deadline)
      dateFields.application_deadline = new Date(data.application_deadline as string);
    if (data.decision_deadline)
      dateFields.decision_deadline = new Date(data.decision_deadline as string);
    if (data.interview_scheduled_at)
      dateFields.interview_scheduled_at = new Date(data.interview_scheduled_at as string);
    if (data.follow_up_date)
      dateFields.follow_up_date = new Date(data.follow_up_date as string);

    Object.assign(application, {
      ...data,
      ...dateFields,
      metadata: mergedMetadata,
      status_history: nextStatusHistory,
    });

    const updatedApplication = await this.jobApplicationRepository.save(application);
    this.logger.log(`Job application updated successfully: ${id}`);
    return updatedApplication;
  } catch (error) {
    if (error instanceof NotFoundException || error instanceof ForbiddenException) {
      throw error;
    }
    this.logger.error('Error updating job application:', error);
    throw new BadRequestException(
      'Failed to update job application',
      ERROR_CODES.BAD_REQUEST,
    );
  }
}
```

- [ ] **Step 15.3:** Add the imports for `appendStatusHistoryIfChanged` and `IJobApplicationStatusHistoryEntry` at the top of `job-application.service.ts`. Run `npm run build`.

---

### Task 16: Update `JobApplicationController` to pass new fields through

- **path:** `src/modules/job-application/job-application.controller.ts:48-76` (create), `:203-235` (update), `:271-297` (mapToResponseDto)
- **intent:** Stop dropping the new fields when mapping DTO → service input and entity → response.
- **verify:** `npm run build` clean. `mapToResponseDto` returns every new column.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/API-PATTERNS.md` ("Layer responsibilities" — controller is thin).

- [ ] **Step 16.1:** Replace `createJobApplication`'s service call with a single spread (controller stays thin — DTO already validated):

```ts
const userContext = request?.userContext;
const jobApplication = await this.jobApplicationService.createJobApplication({
  user_id: userContext?.userId,
  ...dto,
});
return this.mapToResponseDto(jobApplication);
```

- [ ] **Step 16.2:** Replace `updateJobApplication`'s service call similarly:

```ts
const userContext = request?.userContext;
const application = await this.jobApplicationService.updateJobApplication(
  id,
  { ...dto },
  { userId: userContext?.userId },
);
return this.mapToResponseDto(application);
```

- [ ] **Step 16.3:** Replace `mapToResponseDto` with:

```ts
private mapToResponseDto(application: any): JobApplicationResponseDto {
  return {
    id: application.id,
    company_name: application.company_name,
    job_position: application.job_position,
    job_description: application.job_description,
    job_url: application.job_url,
    job_location: application.job_location,
    employment_type: application.employment_type,
    work_mode: application.work_mode,
    salary_min: application.salary_min,
    salary_max: application.salary_max,
    salary_currency: application.salary_currency,
    pay_period: application.pay_period,
    salary_negotiable: application.salary_negotiable,
    status: application.status,
    application_source: application.application_source,
    job_board_source: application.job_board_source,
    applied_via: application.applied_via,
    priority: application.priority,
    tags: application.tags,
    application_deadline: application.application_deadline,
    applied_at: application.applied_at,
    decision_deadline: application.decision_deadline,
    next_action: application.next_action,
    cover_letter: application.cover_letter,
    notes: application.notes,
    recruiter_name: application.recruiter_name,
    recruiter_email: application.recruiter_email,
    recruiter_phone: application.recruiter_phone,
    hiring_manager_name: application.hiring_manager_name,
    hiring_manager_email: application.hiring_manager_email,
    contact_phone: application.contact_phone,
    contacts: application.contacts,
    interview_scheduled_at: application.interview_scheduled_at,
    interview_notes: application.interview_notes,
    follow_up_date: application.follow_up_date,
    rejection_stage: application.rejection_stage,
    rejection_reason: application.rejection_reason,
    rejection_feedback_received: application.rejection_feedback_received,
    compensation_offer: application.compensation_offer,
    attachments: application.attachments,
    status_history: application.status_history,
    metadata: application.metadata,
    created_at: application.created_at,
    updated_at: application.updated_at,
    user_id: application.user_id,
  };
}
```

- [ ] **Step 16.4:** Run `npm run build`.

---

### Task 17: Add interview sub-resource DTOs

- **path:** `src/modules/job-application/dtos/job-application-interview.dto.ts`
- **intent:** Validate Create/Update payloads for `/job-applications/:id/interviews`.
- **verify:** `npm run build` clean.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/API-PATTERNS.md` ("Request validation").

- [ ] **Step 17.1:** Create the file:

```ts
import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
  IsInt,
  Min,
  IsEmail,
} from 'class-validator';
import { InterviewStage } from '../enums/interview-stage.enum';
import { InterviewFormat } from '../enums/interview-format.enum';
import { InterviewOutcome } from '../enums/interview-outcome.enum';

export class CreateJobApplicationInterviewDto {
  @IsEnum(InterviewStage) stage: InterviewStage;
  @IsOptional() @IsEnum(InterviewFormat) format?: InterviewFormat;
  @IsOptional() @IsEnum(InterviewOutcome) outcome?: InterviewOutcome;
  @IsOptional() @IsDateString() scheduled_at?: string;
  @IsOptional() @IsDateString() completed_at?: string;
  @IsOptional() @IsInt() @Min(0) duration_minutes?: number;
  @IsOptional() @IsString() @MaxLength(200) interviewer_name?: string;
  @IsOptional() @IsString() @IsEmail() interviewer_email?: string;
  @IsOptional() @IsString() @MaxLength(500) location_or_link?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}

export class UpdateJobApplicationInterviewDto {
  @IsOptional() @IsEnum(InterviewStage) stage?: InterviewStage;
  @IsOptional() @IsEnum(InterviewFormat) format?: InterviewFormat;
  @IsOptional() @IsEnum(InterviewOutcome) outcome?: InterviewOutcome;
  @IsOptional() @IsDateString() scheduled_at?: string;
  @IsOptional() @IsDateString() completed_at?: string;
  @IsOptional() @IsInt() @Min(0) duration_minutes?: number;
  @IsOptional() @IsString() @MaxLength(200) interviewer_name?: string;
  @IsOptional() @IsString() @IsEmail() interviewer_email?: string;
  @IsOptional() @IsString() @MaxLength(500) location_or_link?: string;
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;
}
```

- [ ] **Step 17.2:** Run `npm run build`.

---

### Task 18: Add `JobApplicationInterviewService`

- **path:** `src/modules/job-application/services/job-application-interview.service.ts`
- **intent:** CRUD for interviews. Every operation re-resolves the parent job application by `(id, userId)` so ownership is enforced before any child mutation.
- **verify:** `npm run build` clean.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/SECURITY.md` (ownership), `docs/CONVENTIONS.md` (Service layer).

- [ ] **Step 18.1:** Create the file:

```ts
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobApplication } from '../../../database/entities/job-application.entity';
import { JobApplicationInterview } from '../../../database/entities/job-application-interview.entity';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import {
  CreateJobApplicationInterviewDto,
  UpdateJobApplicationInterviewDto,
} from '../dtos/job-application-interview.dto';

@Injectable()
export class JobApplicationInterviewService {
  private readonly logger = new Logger(JobApplicationInterviewService.name);

  constructor(
    @InjectRepository(JobApplicationInterview)
    private readonly interviewRepository: Repository<JobApplicationInterview>,
    @InjectRepository(JobApplication)
    private readonly jobApplicationRepository: Repository<JobApplication>,
  ) {}

  async listInterviews(
    jobApplicationId: string,
    userId: string,
  ): Promise<JobApplicationInterview[]> {
    await this.assertOwnership(jobApplicationId, userId);
    return this.interviewRepository.find({
      where: { job_application_id: jobApplicationId },
      order: { scheduled_at: 'ASC', created_at: 'ASC' },
    });
  }

  async createInterview(
    jobApplicationId: string,
    userId: string,
    dto: CreateJobApplicationInterviewDto,
  ): Promise<JobApplicationInterview> {
    await this.assertOwnership(jobApplicationId, userId);
    const interview = this.interviewRepository.create({
      job_application_id: jobApplicationId,
      ...dto,
      scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : undefined,
      completed_at: dto.completed_at ? new Date(dto.completed_at) : undefined,
    });
    return this.interviewRepository.save(interview);
  }

  async updateInterview(
    jobApplicationId: string,
    interviewId: string,
    userId: string,
    dto: UpdateJobApplicationInterviewDto,
  ): Promise<JobApplicationInterview> {
    await this.assertOwnership(jobApplicationId, userId);
    const interview = await this.findChildOrThrow(jobApplicationId, interviewId);
    Object.assign(interview, {
      ...dto,
      scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : interview.scheduled_at,
      completed_at: dto.completed_at ? new Date(dto.completed_at) : interview.completed_at,
    });
    return this.interviewRepository.save(interview);
  }

  async deleteInterview(
    jobApplicationId: string,
    interviewId: string,
    userId: string,
  ): Promise<void> {
    await this.assertOwnership(jobApplicationId, userId);
    const interview = await this.findChildOrThrow(jobApplicationId, interviewId);
    await this.interviewRepository.delete(interview.id);
  }

  private async assertOwnership(
    jobApplicationId: string,
    userId: string,
  ): Promise<void> {
    if (!userId) {
      throw new ForbiddenException('Access denied', ERROR_CODES.FORBIDDEN);
    }
    const parent = await this.jobApplicationRepository.findOne({
      where: { id: jobApplicationId, user_id: userId },
    });
    if (!parent) {
      throw new NotFoundException(
        'Job application not found',
        ERROR_CODES.NOT_FOUND,
      );
    }
  }

  private async findChildOrThrow(
    jobApplicationId: string,
    interviewId: string,
  ): Promise<JobApplicationInterview> {
    const interview = await this.interviewRepository.findOne({
      where: { id: interviewId, job_application_id: jobApplicationId },
    });
    if (!interview) {
      throw new NotFoundException(
        'Interview not found',
        ERROR_CODES.NOT_FOUND,
      );
    }
    return interview;
  }
}
```

- [ ] **Step 18.2:** Run `npm run build`.

---

### Task 19: Add `JobApplicationInterviewController`

- **path:** `src/modules/job-application/controllers/job-application-interview.controller.ts`
- **intent:** Mount the interview sub-resource at `/job-applications/:id/interviews` with full CRUD; validation + JWT guard inherited from the existing pattern.
- **verify:** `npm run build` clean. Hit `GET /job-applications/<id>/interviews` returns `[]` initially.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** `docs/API-PATTERNS.md`, existing `JobApplicationController` for style.

- [ ] **Step 19.1:** Create the file:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import { JobApplicationInterviewService } from '../services/job-application-interview.service';
import {
  CreateJobApplicationInterviewDto,
  UpdateJobApplicationInterviewDto,
} from '../dtos/job-application-interview.dto';

@ApiTags('Job Applications')
@Controller('job-applications/:id/interviews')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class JobApplicationInterviewController {
  constructor(
    private readonly interviewService: JobApplicationInterviewService,
  ) {}

  @Get()
  async list(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: RequestWithUserContext,
  ) {
    return this.interviewService.listInterviews(id, request.userContext?.userId);
  }

  @Post()
  async create(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateJobApplicationInterviewDto,
    @Req() request: RequestWithUserContext,
  ) {
    return this.interviewService.createInterview(
      id,
      request.userContext?.userId,
      dto,
    );
  }

  @Put(':interviewId')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('interviewId', ParseUUIDPipe) interviewId: string,
    @Body() dto: UpdateJobApplicationInterviewDto,
    @Req() request: RequestWithUserContext,
  ) {
    return this.interviewService.updateInterview(
      id,
      interviewId,
      request.userContext?.userId,
      dto,
    );
  }

  @Delete(':interviewId')
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('interviewId', ParseUUIDPipe) interviewId: string,
    @Req() request: RequestWithUserContext,
  ): Promise<void> {
    await this.interviewService.deleteInterview(
      id,
      interviewId,
      request.userContext?.userId,
    );
  }
}
```

- [ ] **Step 19.2:** Run `npm run build`.

---

### Task 20: Wire interview entity, service, and controller into `JobApplicationModule`

- **path:** `src/modules/job-application/job-application.module.ts`
- **intent:** Register the new entity in `TypeOrmModule.forFeature`, add the new service to providers, the new controller to controllers, and export the new service so other modules can depend on it later.
- **verify:** `npm run build` clean. `npm run start:dev` boots without DI errors.
- **agency:** `subagentType: "Backend Architect"` / `cursorRule: "@agency-backend-architect.mdc"`
- **docs:** Existing module file for style.

- [ ] **Step 20.1:** Replace the file content:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobApplicationController } from './job-application.controller';
import { JobApplicationInterviewController } from './controllers/job-application-interview.controller';
import { JobApplicationService } from './job-application.service';
import { JobApplicationInterviewService } from './services/job-application-interview.service';
import { JobApplication } from '../../database/entities/job-application.entity';
import { JobApplicationInterview } from '../../database/entities/job-application-interview.entity';
import { ResumeGeneration } from '../../database/entities/resume-generations.entity';
import { User } from '../../database/entities/user.entity';
import { SharedModule } from '../../shared/shared.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { FieldSelectionService } from '../../shared/services/field-selection.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      JobApplication,
      JobApplicationInterview,
      ResumeGeneration,
      User,
    ]),
    SharedModule,
    RateLimitModule,
  ],
  controllers: [JobApplicationController, JobApplicationInterviewController],
  providers: [
    JobApplicationService,
    JobApplicationInterviewService,
    FieldSelectionService,
  ],
  exports: [JobApplicationService, JobApplicationInterviewService],
})
export class JobApplicationModule {}
```

- [ ] **Step 20.2:** Run `npm run build`. Then `npm run start:dev` and verify in logs that NestJS maps the new routes (`/job-applications/:id/interviews ...`).

---

### Task 21: Update spec doc `06-job-applications.md`

- **path:** `docs/specs/06-job-applications.md`
- **intent:** Document the new fields, the interview sub-resource, the relaxed `job_description` requirement, the metadata-merge semantics, the new status taxonomy, and the new query filters. Bump `last_reviewed`.
- **verify:** Manual read — every new field/route from this plan appears in the spec.
- **agency:** `subagentType: "Technical Writer"` / `cursorRule: "@agency-technical-writer.mdc"`
- **docs:** Existing `06-job-applications.md` for tone.

- [ ] **Step 21.1:** Update the front-matter `last_reviewed` to `2026-05-01`.

- [ ] **Step 21.2:** Replace the `## Domain enums (persisted)` section with the new 11-state status list (`wishlist`, `interested`, `applied`, `screening`, `technical_round`, `interviewed`, `offer_received`, `accepted`, `offer_declined`, `rejected`, `withdrawn`) plus a new "Sourcing & sourcing" sub-section listing `JobBoardSource`, `AppliedVia`, `EmploymentType`, `WorkMode`, `PayPeriod`, `ApplicationPriority`, `RejectionStage`, `InterviewStage`, `InterviewFormat`, `InterviewOutcome`.

- [ ] **Step 21.3:** Replace the `## API` table — append rows:

| Method | Path | Behavior |
|---|---|---|
| `GET` | `/:id/interviews` | List interview rounds for an application |
| `POST` | `/:id/interviews` | Create an interview round |
| `PUT` | `/:id/interviews/:interviewId` | Update an interview round |
| `DELETE` | `/:id/interviews/:interviewId` | Delete an interview round |

- [ ] **Step 21.4:** Add a new `## List query parameters` row block listing the new filters: `job_board_source`, `work_mode`, `employment_type`, `priority`, `tag`, `decision_deadline_from`, `decision_deadline_to`.

- [ ] **Step 21.5:** Add a new section `## Salary model` describing `salary_min`, `salary_max`, `salary_currency` (ISO 4217), `pay_period`, `salary_negotiable`, plus the offer-side `compensation_offer` jsonb shape with the keys from `IJobApplicationCompensationOffer`.

- [ ] **Step 21.6:** Add a new section `## Status history` documenting the auto-appended `status_history` jsonb array (one entry per status change, includes `from`, `to`, `changed_at`, `changed_by_user_id`, optional `note`).

- [ ] **Step 21.7:** Add a new section `## Metadata semantics` clarifying that `PUT /:id` shallow-merges `metadata` (does not overwrite the whole jsonb).

- [ ] **Step 21.8:** Add a new acceptance criterion `AC-JOB-08: User can edit every core field (company, position, description, URL, location, salary, employment_type, work_mode, priority, tags, deadlines, recruiter/HM contacts, rejection details, offer compensation) via PUT /:id.` and `AC-JOB-09: User can save jobs as wishlist before applying; job_description is not required for status=wishlist or interested.`

---

### Task 22: Final verification + single feature commit

- **path:** repo root
- **intent:** Confirm the full feature works end-to-end before committing the entire change as one logical commit (per project constraint "no mid-task commits").
- **verify:** All commands listed below succeed.
- **agency:** `subagentType: "Code Reviewer"` / `cursorRule: "@agency-code-reviewer.mdc"`
- **docs:** `.ai/rules.md` ("Git" section), `docs/CONVENTIONS.md` ("Cross-cutting").

- [ ] **Step 22.1:** From repo root, run the full verification triplet:

```bash
npm run lint
npm run build
npx jest                 # confirm no existing tests regressed; no new tests added per project constraint
```

Expect zero errors / zero failures.

- [ ] **Step 22.2:** Apply the migrations on the dev DB if not already:

```bash
npm run typeorm:run    # confirm both 20260501000001 and 20260501000002 succeed
```

- [ ] **Step 22.3:** Manual smoke test against `npm run start:dev`. With a valid JWT in `$TOKEN`:

```bash
# Create a wishlist (no job_description required)
curl -sS -X POST http://localhost:3000/job-applications \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"application_source":"direct_apply","status":"wishlist","company_name":"Acme","job_position":"Senior Engineer","work_mode":"remote","employment_type":"full_time","priority":"top_choice","tags":["remote-only","faang-tier"],"salary_min":120000,"salary_max":160000,"salary_currency":"USD","pay_period":"annual","job_board_source":"linkedin"}' | jq .

# Update — change a core field that was previously uneditable + flip status to applied
JOB_ID=...
curl -sS -X PUT http://localhost:3000/job-applications/$JOB_ID \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"company_name":"Acme Robotics","status":"applied","applied_via":"easy_apply","applied_at":"2026-05-01T12:00:00.000Z","next_action":"Send thank-you email","decision_deadline":"2026-05-15T00:00:00.000Z","compensation_offer":{"base_salary":150000,"bonus_amount":15000,"sign_on_bonus":10000,"currency":"USD","pay_period":"annual"}}' | jq .

# Verify status_history was appended
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:3000/job-applications/$JOB_ID | jq '.status_history'

# Add an interview round
curl -sS -X POST http://localhost:3000/job-applications/$JOB_ID/interviews \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"stage":"recruiter_screen","format":"video","scheduled_at":"2026-05-03T14:00:00.000Z","interviewer_name":"Jane Doe","interviewer_email":"jane@acme.com","duration_minutes":30}' | jq .

# List interview rounds
curl -sS -H "Authorization: Bearer $TOKEN" http://localhost:3000/job-applications/$JOB_ID/interviews | jq .

# Filter list with a new filter
curl -sS -H "Authorization: Bearer $TOKEN" "http://localhost:3000/job-applications?work_mode=remote&priority=top_choice&tag=remote-only" | jq '.applications | length'
```

Expected: each call returns 200/201 with the relevant payload; `status_history` shows `[{from:null,to:"wishlist",...},{from:"wishlist",to:"applied",...}]`; the filter call returns ≥ 1.

- [ ] **Step 22.4:** Stage and commit the complete feature as a single conventional commit:

```bash
git add \
  src/database/entities/job-application.entity.ts \
  src/database/entities/job-application-interview.entity.ts \
  src/database/migrations/20260501000001-expand-job-application-fields.ts \
  src/database/migrations/20260501000002-create-job-application-interviews.ts \
  src/modules/job-application/enums/ \
  src/modules/job-application/interfaces/ \
  src/modules/job-application/dtos/job-application.dto.ts \
  src/modules/job-application/dtos/job-application-response.dto.ts \
  src/modules/job-application/dtos/job-application-query.dto.ts \
  src/modules/job-application/dtos/job-application-interview.dto.ts \
  src/modules/job-application/services/job-application-interview.service.ts \
  src/modules/job-application/services/job-application-status-history.helper.ts \
  src/modules/job-application/controllers/job-application-interview.controller.ts \
  src/modules/job-application/job-application.controller.ts \
  src/modules/job-application/job-application.service.ts \
  src/modules/job-application/job-application.module.ts \
  src/modules/job-application/config/field-selection.config.ts \
  docs/specs/06-job-applications.md

git commit -m "$(cat <<'EOF'
feat(job-application): expand entity into a fully editable, realistic tracker

- Sidebar can now edit every core field (company, position, JD, urls, salary, work_mode, employment_type, priority, tags, deadlines, contacts, rejection, offer comp).
- Salary model: salary_min / salary_max / salary_currency / pay_period / salary_negotiable; structured compensation_offer jsonb.
- Sourcing model: job_board_source + applied_via promoted to first-class enums.
- Status taxonomy gains wishlist, interested, offer_declined; job_description optional pre-applied.
- Auto-appended status_history jsonb on every status change.
- Metadata is now shallow-merged on PUT (was: overwritten).
- New child resource: /job-applications/:id/interviews (stage, format, outcome, scheduled_at, completed_at, interviewer, notes).
- New query filters: work_mode, employment_type, priority, job_board_source, tag, decision_deadline_from/_to.
- Two migrations: 20260501000001 (column adds + renames), 20260501000002 (interviews table).
EOF
)"
```

- [ ] **Step 22.5:** Confirm the commit landed cleanly:

```bash
git status
git log -1 --stat
```

Expect: `working tree clean`, the new commit on top of the current branch (`feat/prompt-pipeline-improvement`).

---

## Self-review checklist (executor reads before starting)

- [ ] Every spec issue raised in analysis has a corresponding task: editability gap (Task 9), salary model (Tasks 4, 5, 8, 9, 10, 16), `application_source` ≠ `job_board_source` (Tasks 1, 4, 5, 12), multi-round interviews (Tasks 6, 7, 17–20), status timeline (Tasks 14, 15), wishlist + relaxed `job_description` (Tasks 3, 8), priority/tags/work_mode/employment_type (Tasks 1, 4, 5, 8, 9, 12), recruiter/HM contacts (Tasks 4, 5, 8, 9), attachments (Tasks 4, 5, 8, 9), rejection workflow (Tasks 4, 5, 8, 9), `metadata` merge fix (Task 15), `decision_deadline` (Tasks 4, 5, 8, 9), `next_action` (Tasks 4, 5, 8, 9), offer comp (Tasks 2, 5, 8, 9, 10), spec doc updated (Task 21).
- [ ] No placeholders. Every step contains complete code.
- [ ] Naming consistent across tasks: `salary_min`/`salary_max` (not `salary_min_amount`); `compensation_offer` (not `offer_comp`); `appendStatusHistoryIfChanged` (not `appendStatusHistory`).
- [ ] No mid-task commits. Single commit at Task 22.
- [ ] No new unit tests added. Existing `*.spec.ts` files left untouched and must keep passing per Task 22.1.
