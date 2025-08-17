import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateJobApplicationTable1692301800000
  implements MigrationInterface
{
  name = 'CreateJobApplicationTable1692301800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create job_applications table
    await queryRunner.query(`
      CREATE TYPE "public"."job_applications_status_enum" AS ENUM(
        'draft', 
        'applied', 
        'under_review', 
        'interview_scheduled', 
        'interviewed', 
        'offer_received', 
        'accepted', 
        'rejected', 
        'withdrawn'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."job_applications_priority_enum" AS ENUM(
        'low', 
        'medium', 
        'high', 
        'urgent'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."job_applications_application_source_enum" AS ENUM(
        'direct_apply', 
        'tailored_resume'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "job_applications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid,
        "guest_id" character varying,
        "company_name" character varying(200) NOT NULL,
        "job_position" character varying(300) NOT NULL,
        "job_description" text NOT NULL,
        "job_url" character varying(500),
        "job_location" character varying(200),
        "employment_type" character varying(100),
        "salary_min" numeric(12,2),
        "salary_max" numeric(12,2),
        "salary_currency" character varying(10),
        "status" "public"."job_applications_status_enum" NOT NULL DEFAULT 'draft',
        "priority" "public"."job_applications_priority_enum" NOT NULL DEFAULT 'medium',
        "application_source" "public"."job_applications_application_source_enum" NOT NULL,
        "application_deadline" TIMESTAMP,
        "applied_at" TIMESTAMP,
        "ats_score" real,
        "ats_analysis" jsonb,
        "ats_match_history_id" uuid,
        "resume_generation_id" uuid,
        "resume_content" text,
        "cover_letter" text,
        "notes" text,
        "contact_person" character varying(200),
        "contact_email" character varying(100),
        "contact_phone" character varying(20),
        "interview_scheduled_at" TIMESTAMP,
        "interview_notes" text,
        "follow_up_date" TIMESTAMP,
        "rejection_reason" text,
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_job_applications_id" PRIMARY KEY ("id")
      )
    `);

    // Create indexes for performance
    await queryRunner.query(`
      CREATE INDEX "IDX_job_applications_user_id_status_created_at" 
      ON "job_applications" ("user_id", "status", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_job_applications_user_id_company_name" 
      ON "job_applications" ("user_id", "company_name")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_job_applications_user_id_application_deadline" 
      ON "job_applications" ("user_id", "application_deadline")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_job_applications_status_created_at" 
      ON "job_applications" ("status", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_job_applications_guest_id_status_created_at" 
      ON "job_applications" ("guest_id", "status", "created_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_job_applications_guest_id_company_name" 
      ON "job_applications" ("guest_id", "company_name")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_job_applications_guest_id_application_deadline" 
      ON "job_applications" ("guest_id", "application_deadline")
    `);

    // Add foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "job_applications" 
      ADD CONSTRAINT "FK_job_applications_user_id" 
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    await queryRunner.query(`
      ALTER TABLE "job_applications" 
      ADD CONSTRAINT "FK_job_applications_ats_match_history_id" 
      FOREIGN KEY ("ats_match_history_id") REFERENCES "ats_match_histories"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "job_applications" 
      ADD CONSTRAINT "FK_job_applications_resume_generation_id" 
      FOREIGN KEY ("resume_generation_id") REFERENCES "resume_generations"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop foreign key constraints
    await queryRunner.query(`
      ALTER TABLE "job_applications" 
      DROP CONSTRAINT "FK_job_applications_resume_generation_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "job_applications" 
      DROP CONSTRAINT "FK_job_applications_ats_match_history_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "job_applications" 
      DROP CONSTRAINT "FK_job_applications_user_id"
    `);

    // Drop indexes
    await queryRunner.query(`
      DROP INDEX "IDX_job_applications_guest_id_application_deadline"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_job_applications_guest_id_company_name"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_job_applications_guest_id_status_created_at"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_job_applications_status_created_at"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_job_applications_user_id_application_deadline"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_job_applications_user_id_company_name"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_job_applications_user_id_status_created_at"
    `);

    // Drop table
    await queryRunner.query(`DROP TABLE "job_applications"`);

    // Drop enums
    await queryRunner.query(`
      DROP TYPE "public"."job_applications_application_source_enum"
    `);

    await queryRunner.query(`
      DROP TYPE "public"."job_applications_priority_enum"
    `);

    await queryRunner.query(`
      DROP TYPE "public"."job_applications_status_enum"
    `);
  }
}
