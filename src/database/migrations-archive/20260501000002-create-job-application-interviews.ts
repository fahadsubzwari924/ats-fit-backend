import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJobApplicationInterviews20260501000002 implements MigrationInterface {
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
    await queryRunner.query(
      `DROP TABLE IF EXISTS "job_application_interviews"`,
    );
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
