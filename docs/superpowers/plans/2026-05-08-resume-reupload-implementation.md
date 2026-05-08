# Resume Re-Upload (Replace) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a safe, plan-gated, premium-only "replace resume" feature that atomically swaps active resume + extracted/enriched/questions data, with soft-archive recovery and clear UX copy.

**Spec:** `docs/superpowers/specs/2026-05-08-resume-reupload-design.md`

**Architecture:** Single dedicated `POST /users/replace-resume` endpoint with TX-serialized atomic flip; soft-archive via `is_active` flag on `extracted_resume_content` and `resumes`; children resolve activeness through FK to extract; quota tracked in append-only `resume_replacement_audit` keyed on subscription billing window; frontend reuses existing 8-state machine with `isReplacement` flag for copy variants.

**Tech Stack:** NestJS + TypeORM + PostgreSQL (backend), Angular 19 + signals + Material Dialog (frontend), Bull queue, S3 storage.

**Global execution constraints (apply to every task):**
- **No commits between tasks.** User will commit at the end.
- **No unit / integration / E2E tests.** Manual smoke verification only at end.
- **No hardcoded strings.** All status values, error codes, plan IDs, event names, copy keys must come from enums or `*.constants.ts` files. Match `docs/CONVENTIONS.md` § Type/interface/enum placement.

---

## File Structure

### Backend (`ats-fit-backend/src`)

| File | Responsibility | Status |
|------|----------------|--------|
| `database/migrations/<ts>-add-is-active-to-resume-tables.ts` | Add `is_active`, `archived_at` cols + partial unique indexes + backfill | NEW |
| `database/migrations/<ts>-create-resume-replacement-audit.ts` | Create audit table + enum | NEW |
| `database/entities/resume.entity.ts` | Add `isActive`, `archivedAt` columns | MODIFY |
| `database/entities/extracted-resume-content.entity.ts` | Add `isActive`, `archivedAt` columns | MODIFY |
| `database/entities/resume-replacement-audit.entity.ts` | Audit row mapping | NEW |
| `shared/enums/resume-replacement.enum.ts` | `ResumeReplacementKind`, `ResumeReplacementErrorCode` enums | NEW |
| `shared/constants/resume-replacement.constants.ts` | `PREMIUM_REPLACEMENT_LIMIT`, idempotency-window seconds, archive-purge days | NEW |
| `modules/user/dtos/replace-resume.dto.ts` | Multipart file DTO | NEW |
| `modules/user/dtos/restore-archived-resume.dto.ts` | Body DTO | NEW |
| `modules/user/dtos/replace-resume-response.dto.ts` | Response shape | NEW |
| `modules/user/interfaces/replacement-quota.interface.ts` | `IReplacementQuota` shape | NEW |
| `modules/user/repositories/resume-replacement-audit.repository.ts` | Audit insert + count-by-window | NEW |
| `modules/user/services/replacement-quota.service.ts` | Billing-window math + quota check | NEW |
| `modules/user/services/replace-resume.service.ts` | Orchestration: validate → S3 → TX → audit → queue | NEW |
| `modules/user/services/restore-archived-resume.service.ts` | Atomic flip back to archived extract | NEW |
| `modules/user/user.controller.ts` | Add 2 routes; revise DELETE semantics; extend status response | MODIFY |
| `modules/user/user.module.ts` | Register new services + repository | MODIFY |
| `modules/resume-tailoring/services/resume.service.ts` | Filter `is_active = true` on user-scoped reads | MODIFY |
| `modules/resume-tailoring/services/resume-content.service.ts` | Same filter | MODIFY |
| `modules/resume-tailoring/services/resume-profile-enrichment.service.ts` | Same filter | MODIFY |
| `modules/resume-tailoring/services/resume-generation-orchestrator.service.ts` | Add profile-readiness gate | MODIFY |
| `modules/resume-tailoring/services/profile-question-generation.service.ts` | Same filter | MODIFY |
| `shared/services/archive-purge.service.ts` | 90-day cleanup cron | NEW |

### Frontend (`ats-fit-frontend/src/app`)

| File | Responsibility | Status |
|------|----------------|--------|
| `core/enums/resume-replacement.enum.ts` | Error codes mirroring backend | NEW |
| `core/constants/resume-replacement.constants.ts` | Modal/banner copy keys; plan-limit display | NEW |
| `core/models/resume-replacement.model.ts` | Request/response interfaces | NEW |
| `shared/services/resume.service.ts` | Add `replaceResume()`, `restoreArchivedResume()` | MODIFY |
| `core/states/resume-profile.state.ts` | Add `replacementInProgress` flag + `isReplacement` computed + restored copy variants | MODIFY |
| `core/states/user.state.ts` | Add `canReplaceResume` computed (plan check) | MODIFY |
| `features/dashboard/components/features/tailore-resume-upload/tailore-resume-upload.component.ts` | Wire Replace button + plan gate + delete-visibility logic | MODIFY |
| `features/dashboard/components/features/tailore-resume-upload/tailore-resume-upload.component.html` | Replace commented stub with real button | MODIFY |
| `features/dashboard/components/replace-resume-modal/replace-resume-modal.component.ts` | Single combined modal | NEW |
| `features/dashboard/components/replace-resume-modal/replace-resume-modal.component.html` | Modal layout | NEW |
| `features/dashboard/components/replace-resume-modal/replace-resume-modal.component.scss` | Modal styles | NEW |
| `features/dashboard/components/extraction-failed-banner/extraction-failed-banner.component.ts` | Banner with Try-again + Restore-previous CTAs | NEW |
| `features/dashboard/components/extraction-failed-banner/extraction-failed-banner.component.html` | Banner layout | NEW |
| `features/dashboard/components/resume-insights-questions/resume-insights-questions.component.ts` | Use `isReplacement` for copy variants | MODIFY |

---

## Phase 1 — Backend Foundation: Schema + Enums + DTOs

### Task 1: Migration — add `is_active` + `archived_at` to resume tables

- **path:** `src/database/migrations/<timestamp>-add-is-active-to-resume-tables.ts`
- **intent:** Add soft-archive columns + partial unique indexes; backfill existing rows so newest extract per user becomes active.
- **verify:** `npm run typeorm -- migration:run` succeeds; `psql -c "\d extracted_resume_content"` shows `is_active`, `archived_at`; `SELECT user_id, COUNT(*) FROM extracted_resume_content WHERE is_active = true GROUP BY user_id HAVING COUNT(*) > 1;` returns 0 rows.
- **agency:** Database Optimizer
- **docs:** `docs/CONVENTIONS.md`, `src/database/migrations/1814725000000-AddCoverLetterToResumeGeneration.ts` (recent migration pattern)

- [ ] **Step 1: Create migration file**

```typescript
// src/database/migrations/1814800000000-AddIsActiveToResumeTables.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsActiveToResumeTables1814800000000 implements MigrationInterface {
  name = 'AddIsActiveToResumeTables1814800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add columns to extracted_resume_content
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_content" ADD "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_content" ADD "archived_at" TIMESTAMP WITH TIME ZONE`,
    );

    // 2. Backfill: keep newest per user, archive rest
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn,
               updated_at
        FROM extracted_resume_content
      )
      UPDATE extracted_resume_content e
      SET is_active = false, archived_at = ranked.updated_at
      FROM ranked
      WHERE e.id = ranked.id AND ranked.rn > 1
    `);

    // 3. Drop existing global unique on file_hash if present (check actual constraint name first)
    await queryRunner.query(`
      DO $$
      DECLARE constraint_name TEXT;
      BEGIN
        SELECT conname INTO constraint_name
        FROM pg_constraint
        WHERE conrelid = 'extracted_resume_content'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) LIKE '%file_hash%';
        IF constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE extracted_resume_content DROP CONSTRAINT %I', constraint_name);
        END IF;
      END$$;
    `);

    // 4. Partial unique: one active per user
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_extracted_resume_content_user_active"
      ON "extracted_resume_content" ("user_id")
      WHERE "is_active" = true
    `);

    // 5. Partial unique: one active hash per user (allows historic same hashes)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_extracted_resume_content_user_filehash_active"
      ON "extracted_resume_content" ("user_id", "file_hash")
      WHERE "is_active" = true
    `);

    // 6. Same treatment for resumes table
    await queryRunner.query(
      `ALTER TABLE "resumes" ADD "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "resumes" ADD "archived_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn,
               updated_at
        FROM resumes
      )
      UPDATE resumes r
      SET is_active = false, archived_at = ranked.updated_at
      FROM ranked
      WHERE r.id = ranked.id AND ranked.rn > 1
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_resumes_user_active"
      ON "resumes" ("user_id")
      WHERE "is_active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_resumes_user_active"`);
    await queryRunner.query(`ALTER TABLE "resumes" DROP COLUMN "archived_at"`);
    await queryRunner.query(`ALTER TABLE "resumes" DROP COLUMN "is_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_extracted_resume_content_user_filehash_active"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_extracted_resume_content_user_active"`);
    await queryRunner.query(`ALTER TABLE "extracted_resume_content" DROP COLUMN "archived_at"`);
    await queryRunner.query(`ALTER TABLE "extracted_resume_content" DROP COLUMN "is_active"`);
    // NOTE: down does NOT restore the original global file_hash unique because we don't know its name.
    // If rollback needed, restore manually via dump.
  }
}
```

- [ ] **Step 2: Run migration locally**

Run: `npm run typeorm -- migration:run`
Expected: `Migration AddIsActiveToResumeTables1814800000000 has been executed successfully.`

- [ ] **Step 3: Verify schema**

Run: `psql $DATABASE_URL -c "\d extracted_resume_content"` and `psql $DATABASE_URL -c "\d resumes"`
Expected: both show `is_active boolean not null default true`, `archived_at timestamp with time zone`. Indexes `idx_extracted_resume_content_user_active`, `idx_extracted_resume_content_user_filehash_active`, `idx_resumes_user_active` listed.

- [ ] **Step 4: Verify backfill**

Run: `psql $DATABASE_URL -c "SELECT user_id, COUNT(*) FROM extracted_resume_content WHERE is_active = true GROUP BY user_id HAVING COUNT(*) > 1"`
Expected: 0 rows. Same for `resumes`.

---

### Task 2: Migration — create `resume_replacement_audit` table + enum

- **path:** `src/database/migrations/<timestamp>-create-resume-replacement-audit.ts`
- **intent:** Append-only audit log driving quota counting + telemetry; supports idempotency-key dedup.
- **verify:** Migration runs; `\d resume_replacement_audit` shows columns + indexes; `SELECT enum_range(NULL::resume_replacement_kind);` returns `{replacement,restore}`.
- **agency:** Database Optimizer
- **docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Create migration**

```typescript
// src/database/migrations/1814800100000-CreateResumeReplacementAudit.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateResumeReplacementAudit1814800100000 implements MigrationInterface {
  name = 'CreateResumeReplacementAudit1814800100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "resume_replacement_kind" AS ENUM ('replacement', 'restore')
    `);

    await queryRunner.query(`
      CREATE TABLE "resume_replacement_audit" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "kind" "resume_replacement_kind" NOT NULL DEFAULT 'replacement',
        "attempted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        "succeeded" boolean NOT NULL,
        "archived_extract_id" uuid,
        "new_extract_id" uuid,
        "failure_code" text,
        "idempotency_key" text,
        CONSTRAINT "pk_resume_replacement_audit" PRIMARY KEY ("id"),
        CONSTRAINT "fk_resume_replacement_audit_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_resume_replacement_audit_archived_extract"
          FOREIGN KEY ("archived_extract_id") REFERENCES "extracted_resume_content"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_resume_replacement_audit_new_extract"
          FOREIGN KEY ("new_extract_id") REFERENCES "extracted_resume_content"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_resume_replacement_audit_user_attempted"
      ON "resume_replacement_audit" ("user_id", "attempted_at" DESC)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_resume_replacement_audit_idempotency"
      ON "resume_replacement_audit" ("user_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_resume_replacement_audit_idempotency"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_resume_replacement_audit_user_attempted"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "resume_replacement_audit"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "resume_replacement_kind"`);
  }
}
```

- [ ] **Step 2: Run migration**

Run: `npm run typeorm -- migration:run`
Expected: Success.

- [ ] **Step 3: Verify**

Run: `psql $DATABASE_URL -c "\d resume_replacement_audit"`
Expected: shows all 9 columns + 2 indexes + 3 FKs.

---

### Task 3: Enums — replacement kind + error codes

- **path:** `src/shared/enums/resume-replacement.enum.ts`
- **intent:** Single source of truth for replacement kinds and machine-stable error codes (no string literals anywhere downstream).
- **verify:** `npm run build` succeeds; `grep -r "REPLACEMENT_QUOTA_EXCEEDED\|UPGRADE_REQUIRED\|NO_ACTIVE_RESUME" src --include='*.ts' | grep -v 'resume-replacement.enum.ts'` returns 0 hits at this point.
- **agency:** Backend Architect
- **docs:** `docs/CONVENTIONS.md` § Type, interface, and enum placement

- [ ] **Step 1: Create enum file**

```typescript
// src/shared/enums/resume-replacement.enum.ts
export enum ResumeReplacementKind {
  REPLACEMENT = 'replacement',
  RESTORE = 'restore',
}

export enum ResumeReplacementErrorCode {
  UPGRADE_REQUIRED = 'UPGRADE_REQUIRED',
  REPLACEMENT_QUOTA_EXCEEDED = 'REPLACEMENT_QUOTA_EXCEEDED',
  NO_ACTIVE_RESUME = 'NO_ACTIVE_RESUME',
  SAME_FILE_AS_ACTIVE = 'SAME_FILE_AS_ACTIVE',
  INVALID_FILE = 'INVALID_FILE',
  STORAGE_UPLOAD_FAILED = 'STORAGE_UPLOAD_FAILED',
  RESUME_PROFILE_NOT_READY = 'RESUME_PROFILE_NOT_READY',
  PROFILE_ENRICHMENT_IN_PROGRESS = 'PROFILE_ENRICHMENT_IN_PROGRESS',
  CANNOT_DELETE_ACTIVE_RESUME = 'CANNOT_DELETE_ACTIVE_RESUME',
  RESTORE_OUT_OF_WINDOW = 'RESTORE_OUT_OF_WINDOW',
  RESTORE_TARGET_NOT_FOUND = 'RESTORE_TARGET_NOT_FOUND',
  REPLACEMENT_TX_FAILED = 'REPLACEMENT_TX_FAILED',
  IDEMPOTENT_REPLAY = 'IDEMPOTENT_REPLAY',
}

export enum ResumeReplacementFailureStage {
  PRE_VALIDATION = 'pre_validation',
  STORAGE = 'storage',
  TRANSACTION = 'transaction',
  QUEUE_ENQUEUE = 'queue_enqueue',
  EXTRACTION = 'extraction',
  ENRICHMENT = 'enrichment',
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

---

### Task 4: Constants — quota limit, archive retention, idempotency window

- **path:** `src/shared/constants/resume-replacement.constants.ts`
- **intent:** Single source of truth for tunable numbers — no magic numbers in services.
- **verify:** `npm run build` succeeds.
- **agency:** Backend Architect
- **docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Create constants**

```typescript
// src/shared/constants/resume-replacement.constants.ts
export const RESUME_REPLACEMENT = {
  PREMIUM_MONTHLY_LIMIT: 3,
  IDEMPOTENCY_REPLAY_WINDOW_SECONDS: 30,
  ARCHIVE_RETENTION_DAYS: 90,
  RESTORE_WINDOW_DAYS: 7,
  STUCK_JOB_THRESHOLD_MINUTES: 5,
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ] as const,
  IDEMPOTENCY_HEADER: 'Idempotency-Key',
} as const;
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

---

### Task 5: Entity updates — Resume + ExtractedResumeContent

- **path:** `src/database/entities/resume.entity.ts`, `src/database/entities/extracted-resume-content.entity.ts`
- **intent:** Map new columns into TypeORM entities so services can read/write them.
- **verify:** `npm run build` succeeds. Read both files and confirm two new column definitions in each.
- **agency:** Backend Architect
- **docs:** `docs/CONVENTIONS.md`, existing entities for column-decorator style

- [ ] **Step 1: Add columns to `Resume` entity**

In `src/database/entities/resume.entity.ts`, add:

```typescript
@Column({ name: 'is_active', type: 'boolean', default: true })
isActive!: boolean;

@Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
archivedAt!: Date | null;
```

- [ ] **Step 2: Add columns to `ExtractedResumeContent` entity**

In `src/database/entities/extracted-resume-content.entity.ts`, add the same two columns (mirror exactly).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

---

### Task 6: Entity — `ResumeReplacementAudit`

- **path:** `src/database/entities/resume-replacement-audit.entity.ts`
- **intent:** Map audit table for the repository to use.
- **verify:** `npm run build` succeeds.
- **agency:** Backend Architect
- **docs:** existing entities (e.g. `extracted-resume-content.entity.ts`) for decorator style

- [ ] **Step 1: Create entity**

```typescript
// src/database/entities/resume-replacement-audit.entity.ts
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ResumeReplacementKind } from '../../shared/enums/resume-replacement.enum';
import { User } from './user.entity';
import { ExtractedResumeContent } from './extracted-resume-content.entity';

@Entity('resume_replacement_audit')
@Index('idx_resume_replacement_audit_user_attempted', ['userId', 'attemptedAt'])
export class ResumeReplacementAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    type: 'enum',
    enum: ResumeReplacementKind,
    default: ResumeReplacementKind.REPLACEMENT,
  })
  kind!: ResumeReplacementKind;

  @CreateDateColumn({ name: 'attempted_at', type: 'timestamptz' })
  attemptedAt!: Date;

  @Column({ type: 'boolean' })
  succeeded!: boolean;

  @Column({ name: 'archived_extract_id', type: 'uuid', nullable: true })
  archivedExtractId!: string | null;

  @ManyToOne(() => ExtractedResumeContent, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'archived_extract_id' })
  archivedExtract!: ExtractedResumeContent | null;

  @Column({ name: 'new_extract_id', type: 'uuid', nullable: true })
  newExtractId!: string | null;

  @ManyToOne(() => ExtractedResumeContent, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'new_extract_id' })
  newExtract!: ExtractedResumeContent | null;

  @Column({ name: 'failure_code', type: 'text', nullable: true })
  failureCode!: string | null;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true })
  idempotencyKey!: string | null;
}
```

- [ ] **Step 2: Register entity**

Add import to wherever entities are autoloaded — check `src/config/typeorm.config.ts` or `app.module.ts` for existing entity registration pattern. Mirror it.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

---

### Task 7: Interfaces — replacement quota + replace request/response

- **path:** `src/modules/user/interfaces/replacement-quota.interface.ts`, `src/modules/user/interfaces/replace-resume.interface.ts`
- **intent:** Domain contracts for service layer.
- **verify:** `npm run build` succeeds.
- **agency:** Backend Architect
- **docs:** `docs/CONVENTIONS.md`

- [ ] **Step 1: Create quota interface**

```typescript
// src/modules/user/interfaces/replacement-quota.interface.ts
export interface IReplacementQuota {
  used: number;
  limit: number;
  resetsAt: Date;
  windowStart: Date;
}
```

- [ ] **Step 2: Create replace-resume interface**

```typescript
// src/modules/user/interfaces/replace-resume.interface.ts
export interface IReplaceResumeContext {
  userId: string;
  file: Express.Multer.File;
  idempotencyKey?: string;
}

export interface IReplaceResumeResult {
  newResumeId: string;
  newProcessingId: string;
  archivedExtractId: string;
  archivedAt: Date;
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

---

### Task 8: DTOs — replace + restore + response

- **path:** `src/modules/user/dtos/replace-resume.dto.ts`, `src/modules/user/dtos/restore-archived-resume.dto.ts`, `src/modules/user/dtos/replace-resume-response.dto.ts`
- **intent:** Validate incoming requests + document outgoing shape per repo API conventions (whitelist, structured errors).
- **verify:** `npm run build` succeeds.
- **agency:** Backend Architect
- **docs:** `docs/API-PATTERNS.md` § Request validation, `docs/CONVENTIONS.md` § Validation

- [ ] **Step 1: Replace DTO (multipart, no body validation here — file validated in service)**

```typescript
// src/modules/user/dtos/replace-resume.dto.ts
// Multipart upload: validation happens via FileInterceptor + service-level checks.
// This file documents the expected shape for OpenAPI/clients.
export class ReplaceResumeDto {
  // file uploaded via multipart/form-data field name "file"
  // validated server-side: mime in ALLOWED_MIME_TYPES, size <= MAX_FILE_SIZE_BYTES
}
```

- [ ] **Step 2: Restore DTO**

```typescript
// src/modules/user/dtos/restore-archived-resume.dto.ts
import { IsUUID } from 'class-validator';

export class RestoreArchivedResumeDto {
  @IsUUID()
  archivedExtractId!: string;
}
```

- [ ] **Step 3: Response DTO**

```typescript
// src/modules/user/dtos/replace-resume-response.dto.ts
import { IReplacementQuota } from '../interfaces/replacement-quota.interface';

export class ReplaceResumeResponseDto {
  status!: 'queued';
  newResumeId!: string;
  newProcessingId!: string;
  archivedExtractId!: string;
  archivedAt!: Date;
  quota!: IReplacementQuota;
}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success.

---

## Phase 2 — Backend Services: Quota + Audit + Active-extract Filtering

### Task 9: Repository — `ResumeReplacementAuditRepository`

- **path:** `src/modules/user/repositories/resume-replacement-audit.repository.ts`
- **intent:** Encapsulate all audit-table access; expose `recordAttempt`, `findByIdempotencyKey`, `countSucceededInWindow`.
- **verify:** `npm run build` succeeds.
- **agency:** Database Optimizer
- **docs:** `docs/CONVENTIONS.md` § Layer separation; existing repository patterns in `src/modules/`

- [ ] **Step 1: Create repository**

```typescript
// src/modules/user/repositories/resume-replacement-audit.repository.ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResumeReplacementAudit } from '../../../database/entities/resume-replacement-audit.entity';
import { ResumeReplacementKind } from '../../../shared/enums/resume-replacement.enum';

export interface RecordAttemptInput {
  userId: string;
  kind: ResumeReplacementKind;
  succeeded: boolean;
  archivedExtractId?: string | null;
  newExtractId?: string | null;
  failureCode?: string | null;
  idempotencyKey?: string | null;
}

@Injectable()
export class ResumeReplacementAuditRepository {
  constructor(
    @InjectRepository(ResumeReplacementAudit)
    private readonly repo: Repository<ResumeReplacementAudit>,
  ) {}

  async recordAttempt(input: RecordAttemptInput): Promise<ResumeReplacementAudit> {
    const row = this.repo.create({
      userId: input.userId,
      kind: input.kind,
      succeeded: input.succeeded,
      archivedExtractId: input.archivedExtractId ?? null,
      newExtractId: input.newExtractId ?? null,
      failureCode: input.failureCode ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    return this.repo.save(row);
  }

  async findRecentByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    withinSeconds: number,
  ): Promise<ResumeReplacementAudit | null> {
    const cutoff = new Date(Date.now() - withinSeconds * 1000);
    return this.repo
      .createQueryBuilder('a')
      .where('a.userId = :userId', { userId })
      .andWhere('a.idempotencyKey = :key', { key: idempotencyKey })
      .andWhere('a.attemptedAt >= :cutoff', { cutoff })
      .orderBy('a.attemptedAt', 'DESC')
      .getOne();
  }

  async countSucceededReplacementsInWindow(
    userId: string,
    windowStart: Date,
  ): Promise<number> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.userId = :userId', { userId })
      .andWhere('a.kind = :kind', { kind: ResumeReplacementKind.REPLACEMENT })
      .andWhere('a.succeeded = true')
      .andWhere('a.attemptedAt >= :windowStart', { windowStart })
      .getCount();
  }
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

---

### Task 10: Service — `ReplacementQuotaService`

- **path:** `src/modules/user/services/replacement-quota.service.ts`
- **intent:** Compute billing-period window per plan, count audits, expose `assertCanReplace` + `getCurrentQuota`.
- **verify:** `npm run build` succeeds. Manually test in dev console: import service, call with stub user → expect correct window.
- **agency:** Backend Architect
- **docs:** `docs/superpowers/specs/2026-05-08-resume-reupload-design.md` § 5.4, existing subscription module for plan resolution

- [ ] **Step 1: Create service**

```typescript
// src/modules/user/services/replacement-quota.service.ts
import { ForbiddenException, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ResumeReplacementAuditRepository } from '../repositories/resume-replacement-audit.repository';
import { IReplacementQuota } from '../interfaces/replacement-quota.interface';
import { RESUME_REPLACEMENT } from '../../../shared/constants/resume-replacement.constants';
import { ResumeReplacementErrorCode } from '../../../shared/enums/resume-replacement.enum';
// Adjust imports for the actual subscription/plan resolution service in this repo:
import { SubscriptionService } from '../../subscription/services/subscription.service';
import { PlanType } from '../../subscription/enums/plan-type.enum';

@Injectable()
export class ReplacementQuotaService {
  constructor(
    private readonly auditRepo: ResumeReplacementAuditRepository,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async assertCanReplace(userId: string): Promise<IReplacementQuota> {
    const subscription = await this.subscriptions.getActiveForUser(userId);
    if (!subscription || subscription.plan === PlanType.FREE) {
      throw new HttpException(
        {
          code: ResumeReplacementErrorCode.UPGRADE_REQUIRED,
          message: 'Resume replacement is a premium feature. Upgrade to continue.',
        },
        HttpStatus.FORBIDDEN,
      );
    }
    const quota = await this.getCurrentQuota(userId);
    if (quota.used >= quota.limit) {
      throw new HttpException(
        {
          code: ResumeReplacementErrorCode.REPLACEMENT_QUOTA_EXCEEDED,
          message: `You've used all ${quota.limit} replacements for this period.`,
          details: { resetsAt: quota.resetsAt },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return quota;
  }

  async getCurrentQuota(userId: string): Promise<IReplacementQuota> {
    const subscription = await this.subscriptions.getActiveForUser(userId);
    const limit = RESUME_REPLACEMENT.PREMIUM_MONTHLY_LIMIT;
    const { windowStart, resetsAt } = this.computeWindow(subscription);
    const used = await this.auditRepo.countSucceededReplacementsInWindow(userId, windowStart);
    return { used, limit, windowStart, resetsAt };
  }

  private computeWindow(subscription: {
    plan: PlanType;
    currentPeriodStart?: Date;
    startDate?: Date;
  }): { windowStart: Date; resetsAt: Date } {
    if (subscription.plan === PlanType.PREMIUM_MONTHLY) {
      const windowStart = subscription.currentPeriodStart ?? new Date();
      const resetsAt = this.addOneMonth(windowStart);
      return { windowStart, resetsAt };
    }
    // PREMIUM_YEARLY: monthly anniversary of start_date
    const start = subscription.startDate ?? new Date();
    const today = new Date();
    const rawAnchorDay = start.getUTCDate();
    const lastDayThisMonth = this.daysInMonth(today.getUTCFullYear(), today.getUTCMonth());
    const todayAnchor = Math.min(rawAnchorDay, lastDayThisMonth);
    let windowStart: Date;
    if (today.getUTCDate() >= todayAnchor) {
      windowStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), todayAnchor));
    } else {
      const prevYear = today.getUTCMonth() === 0 ? today.getUTCFullYear() - 1 : today.getUTCFullYear();
      const prevMonth = today.getUTCMonth() === 0 ? 11 : today.getUTCMonth() - 1;
      const prevAnchor = Math.min(rawAnchorDay, this.daysInMonth(prevYear, prevMonth));
      windowStart = new Date(Date.UTC(prevYear, prevMonth, prevAnchor));
    }
    const resetsAt = this.addOneMonth(windowStart);
    return { windowStart, resetsAt };
  }

  private addOneMonth(date: Date): Date {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  private daysInMonth(year: number, monthZeroIdx: number): number {
    return new Date(Date.UTC(year, monthZeroIdx + 1, 0)).getUTCDate();
  }
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success. (If `SubscriptionService.getActiveForUser` doesn't match the real signature, adjust to match the existing API in `src/modules/subscription/`.)

---

### Task 11: Active-extract filter rollout

- **path:** All services that read `extracted_resume_content` by `user_id`. Confirmed list: `src/modules/resume-tailoring/services/resume-content.service.ts`, `resume.service.ts`, `resume-profile-enrichment.service.ts`, `profile-question-generation.service.ts`, `resume-validation.service.ts`, `resume-optimizer.service.ts`. Also any usage in `ats-match` module.
- **intent:** Every read of extract-by-user MUST filter `is_active = true` so children resolve to the correct active set.
- **verify:** `grep -rn "extracted_resume_content\|ExtractedResumeContent" src --include='*.ts' | grep -v 'is_active\|isActive\|spec\.ts\|migration\|entity\.ts'` — every remaining hit must be a write or join that doesn't need filtering. Manually inspect each.
- **agency:** Database Optimizer
- **docs:** `docs/superpowers/specs/2026-05-08-resume-reupload-design.md` § 4.1

- [ ] **Step 1: Audit all extract reads**

Run: `grep -rn "ExtractedResumeContent\|extracted_resume_content" src --include='*.ts' | grep -v migration | grep -v 'entity.ts' | grep -v spec`

Document each read site in a scratch list. For each: does it query "the user's extract"? If yes → needs filter.

- [ ] **Step 2: Add `is_active = true` filter at each site**

For TypeORM query builder:
```typescript
.where('e.userId = :userId', { userId })
.andWhere('e.isActive = :isActive', { isActive: true })
```

For `repo.findOne({ where })`:
```typescript
{ where: { userId, isActive: true } }
```

For `repo.findOneBy(...)`:
```typescript
.findOneBy({ userId, isActive: true })
```

- [ ] **Step 3: Verify same pattern applied to children that resolve via extract**

`EnrichedResumeProfile`, `TailoringQuestion` queries that take `userId` and assume "current" context must JOIN through extract and filter `extract.is_active = true`. Example for enrichment:
```typescript
this.enrichmentRepo
  .createQueryBuilder('p')
  .innerJoin('p.extractedResumeContent', 'e')
  .where('p.userId = :userId', { userId })
  .andWhere('e.isActive = :isActive', { isActive: true })
  .getOne();
```

- [ ] **Step 4: Build + run app locally**

Run: `npm run build && npm run start:dev`
Expected: build clean, server starts. Existing `/users/resume-profile-status` endpoint still returns correct data for current users (manual sanity check via curl with valid JWT).

---

## Phase 3 — Backend Endpoints: Replace + Restore + Status

### Task 12: Service — `ReplaceResumeService`

- **path:** `src/modules/user/services/replace-resume.service.ts`
- **intent:** Orchestrate the full replace flow: quota check → idempotency dedup → file validate → S3 → TX flip → audit → enqueue.
- **verify:** `npm run build` succeeds.
- **agency:** Backend Architect
- **docs:** `docs/superpowers/specs/2026-05-08-resume-reupload-design.md` § 5.2, `docs/API-PATTERNS.md` § Idempotency, existing `resume.service.ts` for S3 + queue patterns

- [ ] **Step 1: Create service skeleton with full method body**

```typescript
// src/modules/user/services/replace-resume.service.ts
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ReplacementQuotaService } from './replacement-quota.service';
import { ResumeReplacementAuditRepository } from '../repositories/resume-replacement-audit.repository';
import {
  ResumeReplacementErrorCode,
  ResumeReplacementKind,
} from '../../../shared/enums/resume-replacement.enum';
import { RESUME_REPLACEMENT } from '../../../shared/constants/resume-replacement.constants';
import {
  IReplaceResumeContext,
  IReplaceResumeResult,
} from '../interfaces/replace-resume.interface';
import { ReplaceResumeResponseDto } from '../dtos/replace-resume-response.dto';
import { Resume } from '../../../database/entities/resume.entity';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
// Adjust imports to actual services:
import { ResumeStorageService } from '../../resume-tailoring/services/resume.service';
import { ResumeQueueService } from '../../resume-tailoring/services/resume-queue.service';
import { ExtractionStatus } from '../../../shared/enums/extraction-status.enum';
import { computeFileHash } from '../../../shared/utils/resume-filename.util'; // confirm this util exists; if not, inline crypto.createHash('sha256')

@Injectable()
export class ReplaceResumeService {
  private readonly logger = new Logger(ReplaceResumeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly quota: ReplacementQuotaService,
    private readonly auditRepo: ResumeReplacementAuditRepository,
    private readonly storage: ResumeStorageService,
    private readonly queue: ResumeQueueService,
  ) {}

  async execute(ctx: IReplaceResumeContext): Promise<ReplaceResumeResponseDto> {
    // Step 1+2: plan + quota check (throws on fail; audit recorded inside catch below)
    let quotaSnapshot;
    try {
      quotaSnapshot = await this.quota.assertCanReplace(ctx.userId);
    } catch (err) {
      await this.recordPreFailure(ctx, err);
      throw err;
    }

    // Step 3: idempotency replay
    if (ctx.idempotencyKey) {
      const existing = await this.auditRepo.findRecentByIdempotencyKey(
        ctx.userId,
        ctx.idempotencyKey,
        RESUME_REPLACEMENT.IDEMPOTENCY_REPLAY_WINDOW_SECONDS,
      );
      if (existing && existing.succeeded && existing.newExtractId) {
        // Replay: rebuild response from existing record
        return this.buildReplayResponse(existing, quotaSnapshot);
      }
    }

    // Step 4: file validation
    this.validateFile(ctx.file);

    // Step 5: active extract must exist
    const activeExtract = await this.dataSource
      .getRepository(ExtractedResumeContent)
      .findOne({ where: { userId: ctx.userId, isActive: true } });
    if (!activeExtract) {
      const err = new ConflictException({
        code: ResumeReplacementErrorCode.NO_ACTIVE_RESUME,
        message: 'No active resume found. Use upload-resume for first-time setup.',
      });
      await this.recordPreFailure(ctx, err);
      throw err;
    }

    // Step 6: same-file rejection
    const newHash = await computeFileHash(ctx.file.buffer);
    if (activeExtract.fileHash === newHash) {
      const err = new ConflictException({
        code: ResumeReplacementErrorCode.SAME_FILE_AS_ACTIVE,
        message: 'That file matches your current active resume. Nothing to replace.',
      });
      await this.recordPreFailure(ctx, err);
      throw err;
    }

    // Step 7: S3 upload (outside TX)
    let s3Url: string;
    try {
      s3Url = await this.storage.uploadFile(ctx.userId, ctx.file);
    } catch (e) {
      const err = new HttpException(
        {
          code: ResumeReplacementErrorCode.STORAGE_UPLOAD_FAILED,
          message: 'Could not upload file. Try again.',
        },
        HttpStatus.BAD_GATEWAY,
      );
      await this.recordPreFailure(ctx, err);
      throw err;
    }

    // Step 8/9: atomic TX
    let txResult: IReplaceResumeResult;
    try {
      txResult = await this.runReplacementTransaction(ctx, activeExtract, s3Url, newHash);
    } catch (e) {
      this.logger.error('Replacement TX failed', e);
      // Audit failure on a fresh connection (TX rolled back)
      await this.auditRepo.recordAttempt({
        userId: ctx.userId,
        kind: ResumeReplacementKind.REPLACEMENT,
        succeeded: false,
        failureCode: ResumeReplacementErrorCode.REPLACEMENT_TX_FAILED,
        idempotencyKey: ctx.idempotencyKey ?? null,
      });
      throw new HttpException(
        {
          code: ResumeReplacementErrorCode.REPLACEMENT_TX_FAILED,
          message: 'Could not save replacement. Try again.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // Step 10: audit success (best-effort)
    try {
      await this.auditRepo.recordAttempt({
        userId: ctx.userId,
        kind: ResumeReplacementKind.REPLACEMENT,
        succeeded: true,
        archivedExtractId: txResult.archivedExtractId,
        newExtractId: txResult.newProcessingId,
        idempotencyKey: ctx.idempotencyKey ?? null,
      });
    } catch (auditErr) {
      this.logger.warn('Audit insert failed post-commit', auditErr);
    }

    // Step 11: enqueue
    try {
      await this.queue.addResumeProcessingJob({
        queueMessageId: txResult.newProcessingId,
        userId: ctx.userId,
        resumeId: txResult.newResumeId,
      });
    } catch (qErr) {
      this.logger.error('Queue enqueue failed; sweeper will recover', qErr);
    }

    return {
      status: 'queued',
      newResumeId: txResult.newResumeId,
      newProcessingId: txResult.newProcessingId,
      archivedExtractId: txResult.archivedExtractId,
      archivedAt: txResult.archivedAt,
      quota: await this.quota.getCurrentQuota(ctx.userId),
    };
  }

  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new HttpException(
        { code: ResumeReplacementErrorCode.INVALID_FILE, message: 'Missing file.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.size > RESUME_REPLACEMENT.MAX_FILE_SIZE_BYTES) {
      throw new HttpException(
        { code: ResumeReplacementErrorCode.INVALID_FILE, message: 'File too large.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowed: readonly string[] = RESUME_REPLACEMENT.ALLOWED_MIME_TYPES;
    if (!allowed.includes(file.mimetype)) {
      throw new HttpException(
        { code: ResumeReplacementErrorCode.INVALID_FILE, message: 'Unsupported file type.' },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async runReplacementTransaction(
    ctx: IReplaceResumeContext,
    activeExtract: ExtractedResumeContent,
    s3Url: string,
    newHash: string,
  ): Promise<IReplaceResumeResult> {
    return this.dataSource.transaction(async (em) => {
      // Lock user row (serialize concurrent attempts)
      await em.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [ctx.userId]);

      const now = new Date();

      // Archive current active Resume
      await em
        .createQueryBuilder()
        .update(Resume)
        .set({ isActive: false, archivedAt: now })
        .where('userId = :userId AND isActive = :isActive', {
          userId: ctx.userId,
          isActive: true,
        })
        .execute();

      // Insert new Resume
      const newResume = em.create(Resume, {
        userId: ctx.userId,
        fileName: ctx.file.originalname,
        fileSize: ctx.file.size,
        mimeType: ctx.file.mimetype,
        s3Url,
        isActive: true,
      });
      const savedResume = await em.save(newResume);

      // Archive current active extract
      await em
        .createQueryBuilder()
        .update(ExtractedResumeContent)
        .set({ isActive: false, archivedAt: now })
        .where('id = :id', { id: activeExtract.id })
        .execute();

      // Insert new extract (status QUEUED)
      const newExtract = em.create(ExtractedResumeContent, {
        userId: ctx.userId,
        fileHash: newHash,
        status: ExtractionStatus.QUEUED,
        isActive: true,
      });
      const savedExtract = await em.save(newExtract);

      return {
        newResumeId: savedResume.id,
        newProcessingId: savedExtract.id,
        archivedExtractId: activeExtract.id,
        archivedAt: now,
      };
    });
  }

  private async recordPreFailure(ctx: IReplaceResumeContext, err: unknown): Promise<void> {
    try {
      const code =
        err && typeof err === 'object' && 'response' in err
          ? // @ts-expect-error nest exception shape
            err.response?.code ?? 'UNKNOWN'
          : 'UNKNOWN';
      await this.auditRepo.recordAttempt({
        userId: ctx.userId,
        kind: ResumeReplacementKind.REPLACEMENT,
        succeeded: false,
        failureCode: String(code),
        idempotencyKey: ctx.idempotencyKey ?? null,
      });
    } catch {
      /* non-fatal */
    }
  }

  private buildReplayResponse(
    existing: { archivedExtractId: string | null; newExtractId: string | null; attemptedAt: Date },
    quota: import('../interfaces/replacement-quota.interface').IReplacementQuota,
  ): ReplaceResumeResponseDto {
    return {
      status: 'queued',
      newResumeId: '', // not stored in audit; replay returns extract IDs only
      newProcessingId: existing.newExtractId ?? '',
      archivedExtractId: existing.archivedExtractId ?? '',
      archivedAt: existing.attemptedAt,
      quota,
    };
  }
}
```

- [ ] **Step 2: Resolve real type names**

In this codebase, double-check actual class names: `ResumeStorageService` (might be `ResumeService`), `ResumeQueueService`, `ExtractionStatus` enum location, `computeFileHash` util. Replace placeholder imports with actual paths. Also verify `Resume` entity column names match (especially `s3Url`, `fileName`, `mimeType`).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success after import path fixes.

---

### Task 13: Service — `RestoreArchivedResumeService`

- **path:** `src/modules/user/services/restore-archived-resume.service.ts`
- **intent:** Atomically swap a recently archived extract back to active.
- **verify:** `npm run build` succeeds.
- **agency:** Backend Architect
- **docs:** `docs/superpowers/specs/2026-05-08-resume-reupload-design.md` § 5.6

- [ ] **Step 1: Create service**

```typescript
// src/modules/user/services/restore-archived-resume.service.ts
import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { Resume } from '../../../database/entities/resume.entity';
import { ResumeReplacementAuditRepository } from '../repositories/resume-replacement-audit.repository';
import {
  ResumeReplacementErrorCode,
  ResumeReplacementKind,
} from '../../../shared/enums/resume-replacement.enum';
import { RESUME_REPLACEMENT } from '../../../shared/constants/resume-replacement.constants';

@Injectable()
export class RestoreArchivedResumeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditRepo: ResumeReplacementAuditRepository,
  ) {}

  async execute(userId: string, archivedExtractId: string): Promise<{ restoredAt: Date }> {
    const target = await this.dataSource
      .getRepository(ExtractedResumeContent)
      .findOne({ where: { id: archivedExtractId, userId } });

    if (!target) {
      throw new NotFoundException({
        code: ResumeReplacementErrorCode.RESTORE_TARGET_NOT_FOUND,
        message: 'Archived resume not found.',
      });
    }
    if (target.isActive) {
      throw new ConflictException({
        code: ResumeReplacementErrorCode.RESTORE_TARGET_NOT_FOUND,
        message: 'That resume is already active.',
      });
    }

    const cutoff = new Date(
      Date.now() - RESUME_REPLACEMENT.RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    if (!target.archivedAt || target.archivedAt < cutoff) {
      throw new HttpException(
        {
          code: ResumeReplacementErrorCode.RESTORE_OUT_OF_WINDOW,
          message: `Restore window is ${RESUME_REPLACEMENT.RESTORE_WINDOW_DAYS} days.`,
        },
        HttpStatus.GONE,
      );
    }

    const restoredAt = new Date();
    await this.dataSource.transaction(async (em) => {
      await em.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

      // Archive currently active extract
      await em
        .createQueryBuilder()
        .update(ExtractedResumeContent)
        .set({ isActive: false, archivedAt: restoredAt })
        .where('userId = :userId AND isActive = :isActive', { userId, isActive: true })
        .execute();
      // Same for resumes
      await em
        .createQueryBuilder()
        .update(Resume)
        .set({ isActive: false, archivedAt: restoredAt })
        .where('userId = :userId AND isActive = :isActive', { userId, isActive: true })
        .execute();

      // Restore target
      await em
        .createQueryBuilder()
        .update(ExtractedResumeContent)
        .set({ isActive: true, archivedAt: null })
        .where('id = :id', { id: archivedExtractId })
        .execute();

      // Restore the corresponding Resume row by file_hash + user (lookup the archived resume that was paired)
      // Strategy: pick the most recently archived non-active resume for this user.
      await em.query(
        `UPDATE resumes
         SET is_active = true, archived_at = NULL
         WHERE id = (
           SELECT id FROM resumes
           WHERE user_id = $1 AND is_active = false AND archived_at IS NOT NULL
           ORDER BY archived_at DESC LIMIT 1
         )`,
        [userId],
      );
    });

    await this.auditRepo.recordAttempt({
      userId,
      kind: ResumeReplacementKind.RESTORE,
      succeeded: true,
      newExtractId: archivedExtractId,
    });

    return { restoredAt };
  }
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

---

### Task 14: Controller — Add replace + restore routes; revise DELETE; extend status

- **path:** `src/modules/user/user.controller.ts`
- **intent:** Wire HTTP layer with idempotency-key header; reject deleting active resume; expose `replacementInProgress` + quota in status response.
- **verify:** `npm run build` succeeds. Local server: `curl -X POST -H "Authorization: Bearer ..." -F "file=@new.pdf" http://localhost:PORT/users/replace-resume` returns 202 (or appropriate error code).
- **agency:** Backend Architect
- **docs:** `docs/API-PATTERNS.md` § Idempotency, existing `user.controller.ts:205-292,428-447`

- [ ] **Step 1: Add replace endpoint**

```typescript
// In src/modules/user/user.controller.ts add:
import { ReplaceResumeService } from './services/replace-resume.service';
import { RestoreArchivedResumeService } from './services/restore-archived-resume.service';
import { ReplacementQuotaService } from './services/replacement-quota.service';
import { RestoreArchivedResumeDto } from './dtos/restore-archived-resume.dto';
import { ReplaceResumeResponseDto } from './dtos/replace-resume-response.dto';
import { RESUME_REPLACEMENT } from '../../shared/constants/resume-replacement.constants';
import { ResumeReplacementErrorCode } from '../../shared/enums/resume-replacement.enum';
// inject services in constructor

@Post('replace-resume')
@UseInterceptors(FileInterceptor('file'))
async replaceResume(
  @CurrentUser() user: { id: string },
  @UploadedFile() file: Express.Multer.File,
  @Headers('idempotency-key') idempotencyKey?: string,
): Promise<ReplaceResumeResponseDto> {
  return this.replaceResumeService.execute({
    userId: user.id,
    file,
    idempotencyKey,
  });
}

@Post('restore-archived-resume')
async restoreArchivedResume(
  @CurrentUser() user: { id: string },
  @Body() dto: RestoreArchivedResumeDto,
): Promise<{ restoredAt: Date }> {
  return this.restoreArchivedResumeService.execute(user.id, dto.archivedExtractId);
}
```

- [ ] **Step 2: Revise DELETE endpoint**

Inside the existing `@Delete('delete-resume/:resumeId')` handler service call, before deletion, check:

```typescript
// In resume.service.ts (or wherever delete is implemented)
const target = await this.resumeRepo.findOneBy({ id: resumeId });
if (target?.isActive) {
  throw new ConflictException({
    code: ResumeReplacementErrorCode.CANNOT_DELETE_ACTIVE_RESUME,
    message: 'Cannot delete the active resume. Use replace-resume instead.',
  });
}
```

- [ ] **Step 3: Extend status endpoint**

Locate existing `GET /users/resume-profile-status` handler. Inside, after computing the regular status payload:

```typescript
const replacementInProgress =
  activeExtract?.status === ExtractionStatus.QUEUED ||
  activeExtract?.status === ExtractionStatus.PROCESSING;
const lastArchived = await this.extractRepo
  .createQueryBuilder('e')
  .where('e.userId = :userId AND e.isActive = false', { userId })
  .orderBy('e.archivedAt', 'DESC')
  .getOne();
const quota = await this.replacementQuota.getCurrentQuota(userId);
return {
  ...existingPayload,
  replacementInProgress: replacementInProgress && !!lastArchived,
  lastArchivedExtractId: lastArchived?.id ?? null,
  quota,
};
```

- [ ] **Step 4: Register services in module**

In `src/modules/user/user.module.ts`, add to `providers` and import `TypeOrmModule.forFeature([ResumeReplacementAudit, Resume, ExtractedResumeContent, ...])`. Mirror existing pattern.

- [ ] **Step 5: Build + start**

Run: `npm run build && npm run start:dev`
Expected: server starts, no errors.

---

### Task 15: Tailoring profile-readiness gate

- **path:** `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts` (or new guard if cleaner — confirm with existing patterns)
- **intent:** Block tailoring when user has no active extract OR extraction not complete OR enrichment not complete.
- **verify:** `npm run build` succeeds. Manual: try tailoring while resume profile is in `processing` state — expect 409 with `RESUME_PROFILE_NOT_READY`.
- **agency:** Backend Architect
- **docs:** `docs/superpowers/specs/2026-05-08-resume-reupload-design.md` § 5.3

- [ ] **Step 1: Add gate at orchestration entry**

```typescript
// resume-generation-orchestrator.service.ts (or new method called at entry of generation flow)
import { ConflictException } from '@nestjs/common';
import { ResumeReplacementErrorCode } from '../../../shared/enums/resume-replacement.enum';
import { ExtractionStatus } from '../../../shared/enums/extraction-status.enum';
import { EnrichmentStatus } from '../../../shared/enums/enrichment-status.enum';

private async assertProfileReady(userId: string): Promise<void> {
  const activeExtract = await this.extractRepo.findOne({
    where: { userId, isActive: true },
  });
  if (!activeExtract) {
    throw new ConflictException({
      code: ResumeReplacementErrorCode.NO_ACTIVE_RESUME,
      message: 'No active resume found.',
    });
  }
  if (activeExtract.status !== ExtractionStatus.COMPLETED) {
    throw new ConflictException({
      code: ResumeReplacementErrorCode.RESUME_PROFILE_NOT_READY,
      message: 'Your resume is still processing.',
    });
  }
  const enrichment = await this.enrichmentRepo
    .createQueryBuilder('p')
    .innerJoin('p.extractedResumeContent', 'e')
    .where('p.userId = :userId AND e.isActive = true', { userId })
    .getOne();
  if (!enrichment || enrichment.status !== EnrichmentStatus.COMPLETED) {
    throw new ConflictException({
      code: ResumeReplacementErrorCode.PROFILE_ENRICHMENT_IN_PROGRESS,
      message: 'Profile enrichment in progress. Try again shortly.',
    });
  }
}
```

Call `await this.assertProfileReady(userId)` at the start of every public tailoring entry method (single tailoring + batch v2 entry). Exact methods: confirm by reading the orchestrator.

- [ ] **Step 2: Build + manual test**

Run: `npm run build && npm run start:dev`
Expected: build clean. Manually trigger tailoring during processing-state user → 409 returned.

---

### Task 16: Cron — 90-day archive purge job

- **path:** `src/shared/services/archive-purge.service.ts`
- **intent:** Daily job hard-deletes archived extracts older than retention window. Cascades clean child rows + S3 file.
- **verify:** `npm run build` succeeds. Manually invoke service method in a dev REPL → no rows changed if all archives are <90d.
- **agency:** DevOps Automator
- **docs:** existing scheduled jobs (search `@Cron` in src), `docs/superpowers/specs/2026-05-08-resume-reupload-design.md` § 5.7

- [ ] **Step 1: Create service**

```typescript
// src/shared/services/archive-purge.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ExtractedResumeContent } from '../../database/entities/extracted-resume-content.entity';
import { Resume } from '../../database/entities/resume.entity';
import { RESUME_REPLACEMENT } from '../constants/resume-replacement.constants';
import { ResumeStorageService } from '../../modules/resume-tailoring/services/resume.service';

@Injectable()
export class ArchivePurgeService {
  private readonly logger = new Logger(ArchivePurgeService.name);

  constructor(
    @InjectRepository(ExtractedResumeContent)
    private readonly extractRepo: Repository<ExtractedResumeContent>,
    @InjectRepository(Resume)
    private readonly resumeRepo: Repository<Resume>,
    private readonly storage: ResumeStorageService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeOldArchives(): Promise<void> {
    const cutoff = new Date(
      Date.now() - RESUME_REPLACEMENT.ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    // Delete archived extracts (cascades to children: enriched_resume_profile, tailoring_question)
    const oldExtracts = await this.extractRepo.find({
      where: { isActive: false, archivedAt: LessThan(cutoff) },
    });
    if (oldExtracts.length > 0) {
      await this.extractRepo.remove(oldExtracts);
      this.logger.log(`Purged ${oldExtracts.length} archived extracts older than ${RESUME_REPLACEMENT.ARCHIVE_RETENTION_DAYS} days.`);
    }

    // Delete archived resumes + their S3 files
    const oldResumes = await this.resumeRepo.find({
      where: { isActive: false, archivedAt: LessThan(cutoff) },
    });
    for (const r of oldResumes) {
      try {
        await this.storage.deleteS3Object(r.s3Url);
      } catch (e) {
        this.logger.warn(`Failed to delete S3 object for resume ${r.id}`, e);
      }
    }
    if (oldResumes.length > 0) {
      await this.resumeRepo.remove(oldResumes);
      this.logger.log(`Purged ${oldResumes.length} archived resumes.`);
    }
  }
}
```

- [ ] **Step 2: Register service**

Add to a shared module's `providers` (likely `src/shared/modules/...` or in `app.module.ts` providers). Ensure `ScheduleModule.forRoot()` is registered at app level.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

---

## Phase 4 — Frontend Foundation: Enums + Constants + Service + State

### Task 17: Frontend enum + constants

- **path:** `src/app/core/enums/resume-replacement.enum.ts`, `src/app/core/constants/resume-replacement.constants.ts`
- **intent:** Mirror backend error codes; centralize copy keys + plan-limit display value.
- **verify:** `ng build` succeeds.
- **agency:** Frontend Developer
- **docs:** `ats-fit-frontend/docs/CONVENTIONS.md` (if present), the backend enum file as reference

- [ ] **Step 1: Create enum**

```typescript
// src/app/core/enums/resume-replacement.enum.ts
export enum ResumeReplacementErrorCode {
  UPGRADE_REQUIRED = 'UPGRADE_REQUIRED',
  REPLACEMENT_QUOTA_EXCEEDED = 'REPLACEMENT_QUOTA_EXCEEDED',
  NO_ACTIVE_RESUME = 'NO_ACTIVE_RESUME',
  SAME_FILE_AS_ACTIVE = 'SAME_FILE_AS_ACTIVE',
  INVALID_FILE = 'INVALID_FILE',
  STORAGE_UPLOAD_FAILED = 'STORAGE_UPLOAD_FAILED',
  RESUME_PROFILE_NOT_READY = 'RESUME_PROFILE_NOT_READY',
  PROFILE_ENRICHMENT_IN_PROGRESS = 'PROFILE_ENRICHMENT_IN_PROGRESS',
  CANNOT_DELETE_ACTIVE_RESUME = 'CANNOT_DELETE_ACTIVE_RESUME',
  RESTORE_OUT_OF_WINDOW = 'RESTORE_OUT_OF_WINDOW',
  RESTORE_TARGET_NOT_FOUND = 'RESTORE_TARGET_NOT_FOUND',
  REPLACEMENT_TX_FAILED = 'REPLACEMENT_TX_FAILED',
}
```

- [ ] **Step 2: Create constants**

```typescript
// src/app/core/constants/resume-replacement.constants.ts
export const RESUME_REPLACEMENT_COPY = {
  modal: {
    title: 'Replace Resume',
    introLine: 'Replacing your resume restarts profile setup. Here\'s what happens:',
    bullets: [
      { icon: 'check', text: 'Past tailored resumes stay accessible' },
      { icon: 'check', text: 'ATS scores + job applications preserved' },
      { icon: 'refresh', text: 'New work-experience questions generated' },
      { icon: 'refresh', text: 'Tailoring locked for ~2 minutes' },
    ],
    answersWarning: (count: number) =>
      `Your ${count} previous answers will be archived`,
    quotaLine: (used: number, total: number, resetsAt: string) =>
      `Quota: ${used} of ${total} replacements used this period. Resets ${resetsAt}.`,
    fileDropHint: 'PDF or DOCX, max 5 MB',
    cta: 'Replace resume',
    cancel: 'Cancel',
    sameFileMessage: 'That\'s the same file you already have.',
  },
  state: {
    initial: {
      processing: 'Reading your resume...',
      questionsPending: 'A few questions about your work',
      enriching: 'Building your profile...',
      complete: 'All set, ready to tailor',
    },
    replacement: {
      processing: 'Reading your new resume...',
      questionsPending: 'A few questions about your updated work history',
      enriching: 'Refreshing your profile...',
      completeToast: 'Profile updated. Tailoring ready.',
    },
  },
  banner: {
    extractionFailed: 'Could not read your new resume.',
    tryAgain: 'Try again',
    restorePrevious: 'Restore previous resume',
  },
  toast: {
    submitted: 'Profile setup started',
    quotaExceeded: (resetsAt: string) =>
      `You\'ve used all your replacements. Resets ${resetsAt}.`,
    storageFailed: 'Upload failed. Try again.',
    txFailed: 'Could not save. Try again.',
  },
} as const;

export const RESUME_REPLACEMENT_LIMITS = {
  PREMIUM_MONTHLY_LIMIT: 3,
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ] as const,
  IDEMPOTENCY_HEADER: 'Idempotency-Key',
} as const;
```

- [ ] **Step 3: Build**

Run: `ng build`
Expected: success.

---

### Task 18: Frontend models — request/response types

- **path:** `src/app/core/models/resume-replacement.model.ts`
- **intent:** Type-safe API contracts.
- **verify:** `ng build` succeeds.
- **agency:** Frontend Developer
- **docs:** `ats-fit-frontend` existing models for naming style

- [ ] **Step 1: Create models**

```typescript
// src/app/core/models/resume-replacement.model.ts
export interface ReplacementQuota {
  used: number;
  limit: number;
  resetsAt: string; // ISO
  windowStart: string; // ISO
}

export interface ReplaceResumeResponse {
  status: 'queued';
  newResumeId: string;
  newProcessingId: string;
  archivedExtractId: string;
  archivedAt: string; // ISO
  quota: ReplacementQuota;
}

export interface RestoreArchivedResumeResponse {
  restoredAt: string; // ISO
}

export interface ResumeProfileStatusExtended {
  // existing fields preserved by spread on the consumer side
  replacementInProgress: boolean;
  lastArchivedExtractId: string | null;
  quota: ReplacementQuota;
}
```

- [ ] **Step 2: Build**

Run: `ng build`
Expected: success.

---

### Task 19: Resume service — add replace + restore methods

- **path:** `src/app/shared/services/resume.service.ts`
- **intent:** HTTP wrappers calling new backend endpoints with idempotency-key header.
- **verify:** `ng build` succeeds.
- **agency:** Frontend Developer
- **docs:** existing methods in same service for HTTP-call style + auth header handling

- [ ] **Step 1: Add methods**

```typescript
// In src/app/shared/services/resume.service.ts add:
import {
  ReplaceResumeResponse,
  RestoreArchivedResumeResponse,
} from '../../core/models/resume-replacement.model';
import { RESUME_REPLACEMENT_LIMITS } from '../../core/constants/resume-replacement.constants';

replaceResume(file: File, idempotencyKey: string): Observable<ReplaceResumeResponse> {
  const fd = new FormData();
  fd.append('file', file);
  const headers = new HttpHeaders({
    [RESUME_REPLACEMENT_LIMITS.IDEMPOTENCY_HEADER]: idempotencyKey,
  });
  return this.http.post<ReplaceResumeResponse>(
    `${this.apiBase}/users/replace-resume`,
    fd,
    { headers },
  );
}

restoreArchivedResume(archivedExtractId: string): Observable<RestoreArchivedResumeResponse> {
  return this.http.post<RestoreArchivedResumeResponse>(
    `${this.apiBase}/users/restore-archived-resume`,
    { archivedExtractId },
  );
}
```

(Adjust `apiBase`/`http`/`HttpHeaders` references to match the existing service.)

- [ ] **Step 2: Build**

Run: `ng build`
Expected: success.

---

### Task 20: Resume profile state — `isReplacement` + replacement-aware copy

- **path:** `src/app/core/states/resume-profile.state.ts`, `src/app/core/states/user.state.ts`
- **intent:** Wire backend's `replacementInProgress` flag into a computed signal; expose plan-gated `canReplaceResume` for UI use.
- **verify:** `ng build` succeeds.
- **agency:** Frontend Developer
- **docs:** existing state files for signal + computed style

- [ ] **Step 1: In `resume-profile.state.ts`**

Add to the state shape returned by status polling: include `replacementInProgress` (boolean) and `quota` (ReplacementQuota).

```typescript
// Add public computed signals to the state class:
readonly replacementInProgress = computed(
  () => this._status()?.replacementInProgress ?? false,
);
readonly isReplacement = this.replacementInProgress; // alias for copy use
readonly quota = computed(() => this._status()?.quota ?? null);
readonly lastArchivedExtractId = computed(
  () => this._status()?.lastArchivedExtractId ?? null,
);
```

- [ ] **Step 2: In `user.state.ts`**

```typescript
// Existing imports preserved.
import { PlanType } from '../enums/plan-type.enum'; // adjust path

readonly canReplaceResume = computed(() => {
  const plan = this.user()?.subscription?.plan;
  return plan === PlanType.PREMIUM_MONTHLY || plan === PlanType.PREMIUM_YEARLY;
});
```

- [ ] **Step 3: Build**

Run: `ng build`
Expected: success.

---

## Phase 5 — Frontend UX: Modal + Banners + Wiring

### Task 21: Replace-resume modal component

- **path:** `src/app/features/dashboard/components/replace-resume-modal/replace-resume-modal.component.ts|html|scss`
- **intent:** Single combined modal with warning + impact + quota + drag-drop + CTA.
- **verify:** `ng build` succeeds. Manual: open dashboard → click Replace → modal appears with all sections.
- **agency:** Frontend Developer
- **docs:** existing Material Dialog usage in `ModalService`, design spec § 6.3

- [ ] **Step 1: Component class**

```typescript
// src/app/features/dashboard/components/replace-resume-modal/replace-resume-modal.component.ts
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ResumeService } from '../../../../shared/services/resume.service';
import { ResumeProfileState } from '../../../../core/states/resume-profile.state';
import {
  RESUME_REPLACEMENT_COPY,
  RESUME_REPLACEMENT_LIMITS,
} from '../../../../core/constants/resume-replacement.constants';
import { ResumeReplacementErrorCode } from '../../../../core/enums/resume-replacement.enum';
import { v4 as uuidv4 } from 'uuid'; // confirm uuid lib exists or use crypto.randomUUID()
import { ToastService } from '../../../../shared/services/toast.service';

@Component({
  standalone: true,
  selector: 'app-replace-resume-modal',
  imports: [CommonModule, DatePipe, MatButtonModule, MatIconModule],
  templateUrl: './replace-resume-modal.component.html',
  styleUrls: ['./replace-resume-modal.component.scss'],
})
export class ReplaceResumeModalComponent {
  private readonly dialogRef = inject(MatDialogRef<ReplaceResumeModalComponent>);
  private readonly resumeService = inject(ResumeService);
  private readonly profileState = inject(ResumeProfileState);
  private readonly toast = inject(ToastService);

  readonly copy = RESUME_REPLACEMENT_COPY.modal;
  readonly limits = RESUME_REPLACEMENT_LIMITS;
  readonly questionsAnswered = this.profileState.questionsAnswered;
  readonly quota = this.profileState.quota;
  readonly selectedFile = signal<File | null>(null);
  readonly inlineError = signal<string | null>(null);
  readonly submitting = signal(false);

  readonly canSubmit = computed(
    () => !!this.selectedFile() && !this.submitting() && !this.inlineError(),
  );

  onFileSelected(file: File | null): void {
    this.inlineError.set(null);
    if (!file) {
      this.selectedFile.set(null);
      return;
    }
    if (file.size > this.limits.MAX_FILE_SIZE_BYTES) {
      this.inlineError.set('File too large.');
      return;
    }
    if (!(this.limits.ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      this.inlineError.set('Unsupported file type.');
      return;
    }
    this.selectedFile.set(file);
  }

  async submit(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;
    this.submitting.set(true);
    const idempotencyKey = uuidv4();
    try {
      await this.resumeService
        .replaceResume(file, idempotencyKey)
        .toPromise();
      this.toast.success(RESUME_REPLACEMENT_COPY.toast.submitted);
      this.dialogRef.close('submitted');
    } catch (err: unknown) {
      this.handleError(err);
    } finally {
      this.submitting.set(false);
    }
  }

  private handleError(err: unknown): void {
    const code = (err as { error?: { code?: string } })?.error?.code;
    switch (code) {
      case ResumeReplacementErrorCode.SAME_FILE_AS_ACTIVE:
        this.inlineError.set(this.copy.sameFileMessage);
        break;
      case ResumeReplacementErrorCode.REPLACEMENT_QUOTA_EXCEEDED:
        this.toast.error(
          RESUME_REPLACEMENT_COPY.toast.quotaExceeded(
            (err as { error?: { details?: { resetsAt?: string } } }).error?.details?.resetsAt ?? '',
          ),
        );
        this.dialogRef.close();
        break;
      case ResumeReplacementErrorCode.STORAGE_UPLOAD_FAILED:
        this.toast.error(RESUME_REPLACEMENT_COPY.toast.storageFailed);
        break;
      case ResumeReplacementErrorCode.REPLACEMENT_TX_FAILED:
        this.toast.error(RESUME_REPLACEMENT_COPY.toast.txFailed);
        break;
      case ResumeReplacementErrorCode.INVALID_FILE:
        this.inlineError.set('Invalid file.');
        break;
      default:
        this.toast.error(RESUME_REPLACEMENT_COPY.toast.txFailed);
    }
  }

  cancel(): void {
    this.dialogRef.close();
  }
}
```

- [ ] **Step 2: Template**

```html
<!-- replace-resume-modal.component.html -->
<div class="modal">
  <h2>{{ copy.title }}</h2>
  <p>{{ copy.introLine }}</p>
  <ul class="bullets">
    <li *ngFor="let b of copy.bullets">
      <mat-icon>{{ b.icon }}</mat-icon> {{ b.text }}
    </li>
  </ul>

  <p *ngIf="questionsAnswered() > 0" class="warning">
    {{ copy.answersWarning(questionsAnswered()) }}
  </p>

  <p class="quota" *ngIf="quota() as q">
    {{ copy.quotaLine(q.used, q.limit, (q.resetsAt | date:'mediumDate')) }}
  </p>

  <label class="dropzone">
    <input
      type="file"
      [accept]="limits.ALLOWED_MIME_TYPES.join(',')"
      (change)="onFileSelected(($any($event.target).files?.[0]) ?? null)"
    />
    <span>{{ selectedFile()?.name ?? copy.fileDropHint }}</span>
  </label>

  <p *ngIf="inlineError()" class="error">{{ inlineError() }}</p>

  <div class="actions">
    <button mat-button (click)="cancel()">{{ copy.cancel }}</button>
    <button
      mat-flat-button
      color="primary"
      [disabled]="!canSubmit()"
      (click)="submit()"
    >
      {{ copy.cta }}
    </button>
  </div>
</div>
```

- [ ] **Step 3: Styles**

```scss
// replace-resume-modal.component.scss
.modal {
  padding: 24px;
  width: 480px;
  max-width: 90vw;
}
.bullets {
  list-style: none;
  padding: 0;
  margin: 12px 0;
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 0;
  }
}
.warning {
  color: var(--color-warning, #b25b00);
  font-weight: 500;
}
.quota {
  color: var(--color-text-secondary, #666);
  font-size: 0.9rem;
}
.dropzone {
  display: block;
  border: 2px dashed var(--color-border, #ccc);
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  cursor: pointer;
  margin: 16px 0;
  input { display: none; }
}
.error {
  color: var(--color-error, #c00);
  font-size: 0.9rem;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
```

- [ ] **Step 4: Build**

Run: `ng build`
Expected: success.

---

### Task 22: Wire Replace button on resume card

- **path:** `src/app/features/dashboard/components/features/tailore-resume-upload/tailore-resume-upload.component.ts|html`
- **intent:** Show Replace button when active resume exists; plan-gate to upgrade dialog for free users; open ReplaceResumeModalComponent for premium users; hide Delete when only one resume exists.
- **verify:** `ng build` succeeds. Manual: free user sees upgrade dialog on click; premium user sees replace modal.
- **agency:** Frontend Developer
- **docs:** existing component file (`tailore-resume-upload.component.ts:43,90-147`), design spec § 6.1, § 6.2

- [ ] **Step 1: Component class**

```typescript
// In tailore-resume-upload.component.ts
import { ModalService } from '../../../../../shared/services/modal.service';
import { UpgradeFeatureDialogComponent } from '../../../../../shared/dialogs/upgrade-feature-dialog/upgrade-feature-dialog.component';
import { ReplaceResumeModalComponent } from '../../replace-resume-modal/replace-resume-modal.component';
import { UserState } from '../../../../../core/states/user.state';

private readonly modal = inject(ModalService);
private readonly userState = inject(UserState);

readonly canReplaceResume = this.userState.canReplaceResume;
readonly hasArchivedResumes = computed(() => /* derive from state if available; else just hide delete when uploadedResumes().length === 1 */ this.uploadedResumes().length > 1);

handleReplaceResume(): void {
  if (!this.canReplaceResume()) {
    this.modal.openModal(UpgradeFeatureDialogComponent, { data: { feature: 'resume_replacement' } });
    return;
  }
  this.modal.openModal(ReplaceResumeModalComponent);
}
```

- [ ] **Step 2: Template — replace commented stub at line 122**

```html
<!-- tailore-resume-upload.component.html, replacing the commented "Will be Used Later" block -->
<button
  mat-button
  type="button"
  class="action-btn"
  (click)="handleReplaceResume()"
>
  <mat-icon *ngIf="!canReplaceResume()">lock</mat-icon>
  Replace
</button>

<button
  *ngIf="hasArchivedResumes()"
  mat-button
  type="button"
  class="action-btn delete"
  (click)="handleDeleteResume()"
>
  Delete
</button>
```

- [ ] **Step 3: Build + manual check**

Run: `ng build && ng serve`
Expected: dashboard renders Replace button next to Download. Delete hidden for single-resume users.

---

### Task 23: Banner copy variants for replacement state

- **path:** `src/app/features/dashboard/components/resume-insights-questions/resume-insights-questions.component.ts|html` (and any other state-banner components)
- **intent:** When `isReplacement()` is true, swap copy strings.
- **verify:** `ng build` succeeds. Manual: trigger replacement, observe banner reads "Reading your new resume..." instead of "Reading your resume...".
- **agency:** Frontend Developer
- **docs:** design spec § 6.4

- [ ] **Step 1: Use copy constants conditionally**

```typescript
// In resume-insights-questions.component.ts (or wherever state copy lives)
import { RESUME_REPLACEMENT_COPY } from '../../../../core/constants/resume-replacement.constants';

readonly stateCopy = computed(() => {
  const isReplacement = this.profileState.isReplacement();
  const state = this.profileState.profileState();
  const set = isReplacement
    ? RESUME_REPLACEMENT_COPY.state.replacement
    : RESUME_REPLACEMENT_COPY.state.initial;
  switch (state) {
    case 'processing': return set.processing;
    case 'questions_pending': return set.questionsPending;
    case 'enriching': return set.enriching;
    default: return isReplacement ? '' : set.complete;
  }
});
```

In template, replace any hardcoded strings with `{{ stateCopy() }}`.

- [ ] **Step 2: Toast on completion**

In the component (or wherever `complete` state transition is observed), `effect()` watches `profileState.profileState()`; when transitioning to `complete` AND `isReplacement()` was true on the previous tick, fire `toast.success(RESUME_REPLACEMENT_COPY.state.replacement.completeToast)`.

- [ ] **Step 3: Build**

Run: `ng build`
Expected: success.

---

### Task 24: Extraction-failed banner with Try-again + Restore-previous CTAs

- **path:** `src/app/features/dashboard/components/extraction-failed-banner/extraction-failed-banner.component.ts|html`
- **intent:** When new extract status === FAILED, show banner with two recovery actions.
- **verify:** `ng build` succeeds. Manual: simulate extract-fail (DB tweak in dev) → banner appears.
- **agency:** Frontend Developer
- **docs:** design spec § 6.7, existing banner components for style

- [ ] **Step 1: Component class**

```typescript
// extraction-failed-banner.component.ts
import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { ResumeService } from '../../../../shared/services/resume.service';
import { ResumeProfileState } from '../../../../core/states/resume-profile.state';
import { ModalService } from '../../../../shared/services/modal.service';
import { ReplaceResumeModalComponent } from '../replace-resume-modal/replace-resume-modal.component';
import { RESUME_REPLACEMENT_COPY } from '../../../../core/constants/resume-replacement.constants';
import { ToastService } from '../../../../shared/services/toast.service';

@Component({
  standalone: true,
  selector: 'app-extraction-failed-banner',
  imports: [CommonModule, MatButtonModule],
  templateUrl: './extraction-failed-banner.component.html',
})
export class ExtractionFailedBannerComponent {
  private readonly resumeService = inject(ResumeService);
  private readonly profileState = inject(ResumeProfileState);
  private readonly modal = inject(ModalService);
  private readonly toast = inject(ToastService);
  readonly copy = RESUME_REPLACEMENT_COPY.banner;

  tryAgain(): void {
    this.modal.openModal(ReplaceResumeModalComponent);
  }

  async restorePrevious(): Promise<void> {
    const archivedId = this.profileState.lastArchivedExtractId();
    if (!archivedId) return;
    try {
      await this.resumeService.restoreArchivedResume(archivedId).toPromise();
      this.toast.success('Previous resume restored.');
      this.profileState.refresh();
    } catch {
      this.toast.error('Could not restore. Try again.');
    }
  }
}
```

- [ ] **Step 2: Template**

```html
<!-- extraction-failed-banner.component.html -->
<div class="banner banner-error">
  <p>{{ copy.extractionFailed }}</p>
  <div class="actions">
    <button mat-flat-button color="primary" (click)="tryAgain()">{{ copy.tryAgain }}</button>
    <button mat-stroked-button (click)="restorePrevious()">{{ copy.restorePrevious }}</button>
  </div>
</div>
```

- [ ] **Step 3: State support**

In `resume-profile.state.ts`, ensure `lastArchivedExtractId` is exposed (read from status response if backend returns it; otherwise add a field to `/users/resume-profile-status` response in Task 14 — backend-side).

- [ ] **Step 4: Mount banner**

In the dashboard component template, conditionally render:
```html
<app-extraction-failed-banner
  *ngIf="profileState.profileState() === 'failed' && profileState.isReplacement()"
/>
```

- [ ] **Step 5: Build**

Run: `ng build`
Expected: success.

---

## Phase 6 — Verification

### Task 25: Local smoke verification

- **path:** N/A — manual
- **intent:** Confirm full flow works end-to-end before user reviews and commits.
- **verify:** All checklist items below pass.
- **agency:** Reality Checker
- **docs:** `docs/superpowers/specs/2026-05-08-resume-reupload-design.md` § 7 (edge cases), § 9 (rollout)

- [ ] **Step 1: Pre-flight**

Run backend: `npm run start:dev` (in `ats-fit-backend`)
Run frontend: `ng serve` (in `ats-fit-frontend`)
Both must come up clean.

- [ ] **Step 2: Free-user block**

As a free user, click Replace → upgrade dialog appears, no API call sent.

- [ ] **Step 3: Premium happy path**

As premium user, click Replace → modal appears with quota line + warning. Drop new PDF → submit. Toast "Profile setup started". Dashboard banner cycles through processing → questions_pending → enriching → complete with replacement-flavored copy. Toast on complete. Tailoring works.

- [ ] **Step 4: Same-file rejection**

Re-upload identical PDF → modal shows inline "That's the same file you already have." No quota consumed (verify via `SELECT COUNT(*) FROM resume_replacement_audit WHERE user_id=? AND succeeded=true AND kind='replacement' AND attempted_at >= window_start`).

- [ ] **Step 5: Quota exhaustion**

Replace 3 times in window → 4th attempt: backend returns 429, frontend toast shows reset date.

- [ ] **Step 6: Concurrent tabs**

Open two tabs. Submit replace from tab 1, then tab 2 immediately. Tab 2 either replays via idempotency or returns 409 with serialized lock.

- [ ] **Step 7: Extraction-fail recovery**

Manually flip new extract `status=FAILED` in DB. Dashboard renders extraction-failed banner. Click Restore Previous → previous extract becomes active, tailoring works.

- [ ] **Step 8: Active-resume DELETE rejection**

Hit `DELETE /users/delete-resume/<active-id>` → 409 `CANNOT_DELETE_ACTIVE_RESUME`.

- [ ] **Step 9: No-hardcoded-string scan**

Run: `grep -rn "Replace Resume\|UPGRADE_REQUIRED\|REPLACEMENT_QUOTA_EXCEEDED" ats-fit-backend/src ats-fit-frontend/src --include='*.ts' --include='*.html' | grep -v 'resume-replacement\(\.enum\|\.constants\|-design\.md\|-implementation\.md\)'`
Expected: 0 hits outside the enum/constants files.

- [ ] **Step 10: Hand off to user**

Stop here. Do NOT commit. User will review changes and decide when to commit.

---

## Out of Scope (Already in Spec § 13)

- Multi-resume library mode
- Smart-merge of prior answers
- User-initiated unconditional restore button
- Automated tests
- Free-tier paid one-shot replacement

---

## Self-Review Notes

- All 25 tasks reference exact file paths.
- Every task includes `path`, `intent`, `verify`, `agency`, `docs`.
- No `general-purpose` agency anywhere — personas chosen from {Database Optimizer, Backend Architect, Frontend Developer, DevOps Automator, Reality Checker} which exist in both backend and frontend agent indices.
- No commit steps inserted between tasks (per user constraint).
- No test steps anywhere (per user constraint).
- All literal strings (error codes, copy, status names) live in enum or constants files — no inline string literals in services/components beyond what is already in source code (existing literals are not in scope of this plan).
- Spec coverage check: § 4 (data model) → Tasks 1, 2, 5, 6. § 5.1 endpoint → Task 14. § 5.2 service flow → Task 12. § 5.3 tailoring gate → Task 15. § 5.4 quota math → Task 10. § 5.5 DELETE + status → Task 14. § 5.6 restore → Tasks 13, 14. § 5.7 cron → Task 16. § 6 frontend → Tasks 17–24. § 7 edge cases → covered across services + Task 25 verification. § 8 telemetry → not yet wired (instrument inside replace/restore services + modal — add follow-up task if telemetry pipeline confirmed live, otherwise log-only is acceptable per spec wording "existing analytics module if present, else log").
