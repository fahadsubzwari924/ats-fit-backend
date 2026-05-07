import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandJobApplicationFields20260501000001 implements MigrationInterface {
  name = 'ExpandJobApplicationFields20260501000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Extend ApplicationStatus enum
    await queryRunner.query(
      `ALTER TYPE "public"."job_applications_status_enum" ADD VALUE IF NOT EXISTS 'wishlist' BEFORE 'applied'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."job_applications_status_enum" ADD VALUE IF NOT EXISTS 'interested' BEFORE 'applied'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."job_applications_status_enum" ADD VALUE IF NOT EXISTS 'offer_declined' AFTER 'accepted'`,
    );

    // 2) Rename salary columns
    await queryRunner.query(
      `ALTER TABLE "job_applications" RENAME COLUMN "current_salary" TO "salary_min"`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" RENAME COLUMN "expected_salary" TO "salary_max"`,
    );

    // 3) New compensation columns
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

    // 4) Job-context enums + columns
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

    // 5) Sourcing enums + columns
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

    // 6) Contact convenience columns
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

    // 7) Action / deadline columns
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "next_action" VARCHAR(500) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "decision_deadline" TIMESTAMP NULL`,
    );

    // 8) Rejection metadata
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_rejection_stage_enum" AS ENUM('auto_rejected','after_screening','after_interview','after_offer_declined','other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "rejection_stage" "public"."job_applications_rejection_stage_enum" NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN IF NOT EXISTS "rejection_feedback_received" BOOLEAN NULL`,
    );

    // 9) Structured jsonb additions
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

    // 10) Indexes
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

    await queryRunner.query(
      `ALTER TABLE "job_applications" RENAME COLUMN "salary_max" TO "expected_salary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" RENAME COLUMN "salary_min" TO "current_salary"`,
    );
  }
}
