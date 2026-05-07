import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsersTable1756744152516 implements MigrationInterface {
  name = 'CreateUsersTable1756744152516';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "resume_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "key" character varying NOT NULL, "description" character varying NOT NULL, "thumbnail_image_url" character varying NOT NULL, "remote_url" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_3557a3d8d510490a3bbb8a2532f" UNIQUE ("key"), CONSTRAINT "PK_af47d154a6b5ab9c6d169c56a83" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "resume_generations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" character varying, "guest_id" character varying, "file_path" character varying NOT NULL, "original_content" text NOT NULL, "tailored_content" jsonb NOT NULL, "template_id" character varying, "job_description" character varying, "company_name" character varying, "analysis" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "userId" uuid, "templateId" uuid, CONSTRAINT "PK_7321601531e8496ff1310321107" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_resumes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fileName" character varying(255) NOT NULL, "fileSize" integer NOT NULL, "mimeType" character varying(50) NOT NULL, "s3Url" character varying(512) NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, CONSTRAINT "PK_283661cdef95de905707c846022" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_plan_enum" AS ENUM('freemium', 'premium')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_user_type_enum" AS ENUM('guest', 'registered')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "full_name" character varying NOT NULL, "email" character varying NOT NULL, "password" character varying NOT NULL, "plan" "public"."users_plan_enum" NOT NULL DEFAULT 'freemium', "user_type" "public"."users_user_type_enum" NOT NULL DEFAULT 'registered', "guest_id" character varying, "ip_address" character varying, "user_agent" character varying, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."usage_tracking_feature_type_enum" AS ENUM('resume_generation', 'ats_score', 'ats_score_history', 'job_application_tracking')`,
    );
    await queryRunner.query(
      `CREATE TABLE "usage_tracking" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" character varying, "guest_id" character varying, "ip_address" character varying, "feature_type" "public"."usage_tracking_feature_type_enum" NOT NULL, "month" integer NOT NULL, "year" integer NOT NULL, "usage_count" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "last_used_at" TIMESTAMP, "userId" uuid, CONSTRAINT "PK_2879a43395bb513204f88769aa6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_df86c9490cd1a45431d9612d6b" ON "usage_tracking" ("ip_address", "feature_type", "month", "year") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_58394bc638089670195fcc9bf5" ON "usage_tracking" ("guest_id", "feature_type", "month", "year") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c8f4f5a55135dece756b70f2f" ON "usage_tracking" ("user_id", "feature_type", "month", "year") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ats_match_histories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "guest_id" character varying, "resume_content" text NOT NULL, "job_description" text NOT NULL, "company_name" character varying, "ats_score" double precision NOT NULL, "analysis" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3af70cbbedfe22776f2078f4cac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_status_enum" AS ENUM('applied', 'screening', 'technical_round', 'interviewed', 'offer_received', 'accepted', 'rejected', 'withdrawn')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_application_source_enum" AS ENUM('direct_apply', 'tailored_resume')`,
    );
    await queryRunner.query(
      `CREATE TABLE "job_applications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "guest_id" character varying, "company_name" character varying(200) NOT NULL, "job_position" character varying(300) NOT NULL, "job_description" text NOT NULL, "job_url" character varying(500), "job_location" character varying(200), "current_salary" numeric(12,2), "expected_salary" numeric(12,2), "status" "public"."job_applications_status_enum" NOT NULL DEFAULT 'applied', "application_source" "public"."job_applications_application_source_enum" NOT NULL, "application_deadline" TIMESTAMP, "applied_at" TIMESTAMP, "ats_score" double precision, "ats_analysis" jsonb, "ats_match_history_id" uuid, "resume_generation_id" uuid, "resume_content" text, "cover_letter" text, "notes" text, "contact_phone" character varying(20), "interview_scheduled_at" TIMESTAMP, "interview_notes" text, "follow_up_date" TIMESTAMP, "rejection_reason" text, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c56a5e86707d0f0df18fa111280" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24aa575a4743e5b82fc4a3d8c1" ON "job_applications" ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7990d5ae708a99ddf9d3310d95" ON "job_applications" ("user_id", "application_deadline") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_813c9c68e1a1d25f96e4be76b6" ON "job_applications" ("user_id", "company_name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d4e17cf0e407522b4bbf6ab8c4" ON "job_applications" ("user_id", "status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rate_limit_configs_plan_enum" AS ENUM('freemium', 'premium')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rate_limit_configs_user_type_enum" AS ENUM('guest', 'registered')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rate_limit_configs_feature_type_enum" AS ENUM('resume_generation', 'ats_score', 'ats_score_history', 'job_application_tracking')`,
    );
    await queryRunner.query(
      `CREATE TABLE "rate_limit_configs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan" "public"."rate_limit_configs_plan_enum" NOT NULL, "user_type" "public"."rate_limit_configs_user_type_enum" NOT NULL, "feature_type" "public"."rate_limit_configs_feature_type_enum" NOT NULL, "monthly_limit" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "description" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b030bece4024127ec07005697da" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c5674532bcf2890f0cc6381ab0" ON "rate_limit_configs" ("plan", "user_type", "feature_type") `,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD CONSTRAINT "FK_5a70821e432250ee40bc8bd434a" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD CONSTRAINT "FK_8f064d32d49a6edb2cfd4960da9" FOREIGN KEY ("templateId") REFERENCES "resume_templates"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_resumes" ADD CONSTRAINT "FK_d9194b75eda937baf47f31a0c64" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_tracking" ADD CONSTRAINT "FK_5d8df20d681cd50fcde4db2db32" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ats_match_histories" ADD CONSTRAINT "FK_3b4d57a6545551fff0be85fea54" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD CONSTRAINT "FK_fcfc78a3be953dac2443b9b53db" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD CONSTRAINT "FK_2633c4c2fec8dc1d6098475d34d" FOREIGN KEY ("resume_generation_id") REFERENCES "resume_generations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD CONSTRAINT "FK_75c0b287413f0e19545b4f355b7" FOREIGN KEY ("ats_match_history_id") REFERENCES "ats_match_histories"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "job_applications" DROP CONSTRAINT "FK_75c0b287413f0e19545b4f355b7"`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" DROP CONSTRAINT "FK_2633c4c2fec8dc1d6098475d34d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" DROP CONSTRAINT "FK_fcfc78a3be953dac2443b9b53db"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ats_match_histories" DROP CONSTRAINT "FK_3b4d57a6545551fff0be85fea54"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_tracking" DROP CONSTRAINT "FK_5d8df20d681cd50fcde4db2db32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_resumes" DROP CONSTRAINT "FK_d9194b75eda937baf47f31a0c64"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP CONSTRAINT "FK_8f064d32d49a6edb2cfd4960da9"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP CONSTRAINT "FK_5a70821e432250ee40bc8bd434a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c5674532bcf2890f0cc6381ab0"`,
    );
    await queryRunner.query(`DROP TABLE "rate_limit_configs"`);
    await queryRunner.query(
      `DROP TYPE "public"."rate_limit_configs_feature_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."rate_limit_configs_user_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."rate_limit_configs_plan_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d4e17cf0e407522b4bbf6ab8c4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_813c9c68e1a1d25f96e4be76b6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7990d5ae708a99ddf9d3310d95"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24aa575a4743e5b82fc4a3d8c1"`,
    );
    await queryRunner.query(`DROP TABLE "job_applications"`);
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_application_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_status_enum"`,
    );
    await queryRunner.query(`DROP TABLE "ats_match_histories"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4c8f4f5a55135dece756b70f2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_58394bc638089670195fcc9bf5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df86c9490cd1a45431d9612d6b"`,
    );
    await queryRunner.query(`DROP TABLE "usage_tracking"`);
    await queryRunner.query(
      `DROP TYPE "public"."usage_tracking_feature_type_enum"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_user_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."users_plan_enum"`);
    await queryRunner.query(`DROP TABLE "user_resumes"`);
    await queryRunner.query(`DROP TABLE "resume_generations"`);
    await queryRunner.query(`DROP TABLE "resume_templates"`);
  }
}
