import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1777938340136 implements MigrationInterface {
  name = 'InitialSchema1777938340136';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "resume_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "key" character varying NOT NULL, "description" character varying NOT NULL, "thumbnail_image_url" character varying NOT NULL, "remote_url" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_3557a3d8d510490a3bbb8a2532f" UNIQUE ("key"), CONSTRAINT "PK_af47d154a6b5ab9c6d169c56a83" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "resume_generations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" character varying, "file_path" character varying NOT NULL, "original_content" text NOT NULL, "tailored_content" jsonb NOT NULL, "template_id" character varying, "job_description" character varying, "company_name" character varying, "job_position" character varying, "analysis" jsonb, "keywords_added" integer, "sections_optimized" integer, "achievements_quantified" integer, "optimization_confidence" double precision, "ats_checks_passed" integer, "ats_checks_total" integer, "bullets_quantified_before" integer, "bullets_quantified_after" integer, "match_score_before" double precision, "match_score_after" double precision, "pdf_s3_key" character varying, "job_analysis" jsonb, "candidate_content" jsonb, "changes_diff" jsonb, "prompt_version" character varying(16), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "userId" uuid, "templateId" uuid, CONSTRAINT "PK_7321601531e8496ff1310321107" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_resumes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fileName" character varying(255) NOT NULL, "fileSize" integer NOT NULL, "mimeType" character varying(50) NOT NULL, "s3Url" character varying(512) NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "user_id" uuid, CONSTRAINT "PK_283661cdef95de905707c846022" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_history_status_enum" AS ENUM('pending', 'success', 'failed', 'cancelled', 'refunded', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."payment_history_payment_type_enum" AS ENUM('subscription', 'one_time', 'refund')`,
    );
    await queryRunner.query(
      `CREATE TABLE "payment_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "payment_gateway_transaction_id" character varying NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "status" "public"."payment_history_status_enum" NOT NULL DEFAULT 'pending', "payment_type" "public"."payment_history_payment_type_enum" NOT NULL, "user_id" uuid NOT NULL, "subscription_plan_id" uuid, "payment_gateway_response" jsonb NOT NULL, "customer_email" character varying, "is_test_mode" boolean NOT NULL DEFAULT false, "processed_at" TIMESTAMP, "retry_count" integer NOT NULL DEFAULT '0', "last_retry_at" TIMESTAMP, "processing_error" text, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5fcec51a769b65c0c3c0987f11c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_16ab451b0242ee468a05bf72a5" ON "payment_history" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_87a6f5afc86958a2206e337065" ON "payment_history" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."subscription_plans_billing_cycle_enum" AS ENUM('monthly', 'yearly')`,
    );
    await queryRunner.query(
      `CREATE TABLE "subscription_plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan_name" character varying NOT NULL, "description" text NOT NULL, "price" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "payment_gateway_variant_id" character varying NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "features" jsonb, "billing_cycle" "public"."subscription_plans_billing_cycle_enum", "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_608aeb4a0ed13553b4c48385016" UNIQUE ("payment_gateway_variant_id"), CONSTRAINT "PK_9ab8fe6918451ab3d0a4fb6bb0c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_608aeb4a0ed13553b4c4838501" ON "subscription_plans" ("payment_gateway_variant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."user_subscriptions_status_enum" AS ENUM('active', 'cancelled', 'expired', 'paused', 'past_due')`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "payment_gateway_subscription_id" character varying NOT NULL, "status" "public"."user_subscriptions_status_enum" NOT NULL DEFAULT 'active', "amount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "starts_at" TIMESTAMP NOT NULL DEFAULT NOW(), "ends_at" TIMESTAMP NOT NULL, "is_active" boolean NOT NULL DEFAULT false, "is_cancelled" boolean NOT NULL DEFAULT false, "cancelled_at" TIMESTAMP, "user_id" uuid NOT NULL, "subscription_plan_id" uuid NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT NOW(), "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(), CONSTRAINT "PK_9e928b0954e51705ab44988812c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cf427b0b12e1b2ee93a64328e1" ON "user_subscriptions" ("user_id", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "password_reset_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "token_hash" character varying(64) NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "ip_address" character varying(45), "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_91185d86d5d7557b19abbb2868b" UNIQUE ("token_hash"), CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_plan_enum" AS ENUM('freemium', 'premium')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_user_type_enum" AS ENUM('registered')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_registration_type_enum" AS ENUM('general', 'google')`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "full_name" character varying NOT NULL, "email" character varying NOT NULL, "password" character varying NOT NULL, "plan" "public"."users_plan_enum" NOT NULL DEFAULT 'freemium', "user_type" "public"."users_user_type_enum" NOT NULL DEFAULT 'registered', "registration_type" "public"."users_registration_type_enum" NOT NULL DEFAULT 'general', "oauth_provider_data" jsonb, "ip_address" character varying, "user_agent" character varying, "is_active" boolean NOT NULL DEFAULT true, "onboarding_completed" boolean NOT NULL DEFAULT false, "is_beta_user" boolean NOT NULL DEFAULT false, "beta_access_until" TIMESTAMP WITH TIME ZONE, "founding_rate_locked" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."usage_tracking_feature_type_enum" AS ENUM('resume_generation', 'job_application_tracking', 'cover_letter', 'resume_batch_generation')`,
    );
    await queryRunner.query(
      `CREATE TABLE "usage_tracking" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" character varying, "ip_address" character varying, "feature_type" "public"."usage_tracking_feature_type_enum" NOT NULL, "month" integer NOT NULL, "year" integer NOT NULL, "usage_count" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "last_used_at" TIMESTAMP, "userId" uuid, CONSTRAINT "PK_2879a43395bb513204f88769aa6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_df86c9490cd1a45431d9612d6b" ON "usage_tracking" ("ip_address", "feature_type", "month", "year") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4c8f4f5a55135dece756b70f2f" ON "usage_tracking" ("user_id", "feature_type", "month", "year") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."queue_messages_status_enum" AS ENUM('queued', 'processing', 'completed', 'failed', 'retrying')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."queue_messages_priority_enum" AS ENUM('low', 'normal', 'high', 'critical')`,
    );
    await queryRunner.query(
      `CREATE TABLE "queue_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "queue_name" character varying(100) NOT NULL, "job_type" character varying(100) NOT NULL, "correlation_id" uuid, "user_id" uuid, "entity_name" character varying(100), "entity_id" character varying(255), "payload" jsonb NOT NULL, "result" jsonb, "status" "public"."queue_messages_status_enum" NOT NULL DEFAULT 'queued', "priority" "public"."queue_messages_priority_enum" NOT NULL DEFAULT 'normal', "attempts" integer NOT NULL DEFAULT '0', "max_attempts" integer NOT NULL DEFAULT '3', "queued_at" TIMESTAMP NOT NULL DEFAULT now(), "started_at" TIMESTAMP, "completed_at" TIMESTAMP, "processing_duration_ms" integer, "error_details" text, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a03df786f4a362bac2b807f4f95" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73fa506e7d32c6689624270f0f" ON "queue_messages" ("status", "attempts", "max_attempts") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_55ff14f135000b8fd3c64fe6ec" ON "queue_messages" ("status", "queued_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d9817181e2aec29462a1ac0265" ON "queue_messages" ("correlation_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ab763366ae0852f4a5981b39e1" ON "queue_messages" ("entity_name", "entity_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e55a8b06acc50b03ec17c262d8" ON "queue_messages" ("user_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_74a9bd9e701c0a8ad8aa9e270d" ON "queue_messages" ("job_type", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_533139149603462e5c6b8dea3b" ON "queue_messages" ("queue_name", "status") `,
    );
    await queryRunner.query(
      `CREATE TABLE "extracted_resume_contents" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "queue_message_id" uuid NOT NULL, "original_file_name" character varying(255) NOT NULL, "file_size" integer NOT NULL, "file_hash" character varying(64) NOT NULL, "extracted_text" text NOT NULL, "structured_content" jsonb NOT NULL, "usage_count" integer NOT NULL DEFAULT '0', "last_used_at" TIMESTAMP, "business_metadata" jsonb NOT NULL DEFAULT '{}', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_177e1d803446238c7aa73cc966e" UNIQUE ("file_hash"), CONSTRAINT "PK_c9f78211c96feccd505080b1ebc" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_177e1d803446238c7aa73cc966" ON "extracted_resume_contents" ("file_hash") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7481d6b5408c4ca8790d27f3f1" ON "extracted_resume_contents" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "tailoring_questions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "extracted_resume_content_id" uuid NOT NULL, "source" character varying(20) NOT NULL DEFAULT 'profile', "work_experience_index" integer NOT NULL, "bullet_point_index" integer NOT NULL, "original_bullet_point" text NOT NULL, "question_text" text NOT NULL, "question_category" character varying(50) NOT NULL, "user_response" text, "is_answered" boolean NOT NULL DEFAULT false, "order_index" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e3585c6563e5f83080e41112f1b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "resume_generation_results" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "queue_message_id" uuid, "user_id" uuid, "pdf_content" text, "pdf_url" character varying(500), "filename" character varying(255) NOT NULL, "file_size_bytes" integer NOT NULL, "resume_generation_id" uuid NOT NULL, "ats_score" integer NOT NULL, "ats_confidence" integer NOT NULL DEFAULT '0', "ats_match_history_id" uuid, "template_id" character varying(50) NOT NULL, "company_name" character varying(255) NOT NULL, "job_position" character varying(255) NOT NULL, "keywords_added" integer NOT NULL DEFAULT '0', "sections_optimized" integer NOT NULL DEFAULT '0', "optimization_confidence" integer NOT NULL DEFAULT '0', "processing_metrics" jsonb, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "expires_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_fa936470b75fcbd46945531ab25" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d0eec62f5cd1dbf361cda778b" ON "resume_generation_results" ("user_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1242dbe804f4f4e627cb5be072" ON "resume_generation_results" ("expires_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f55e30f1393e8e3a5b597968ca" ON "resume_generation_results" ("queue_message_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d813c03cd7fff946deb36f826d" ON "resume_generation_results" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rate_limit_configs_plan_enum" AS ENUM('freemium', 'premium')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rate_limit_configs_user_type_enum" AS ENUM('registered')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."rate_limit_configs_feature_type_enum" AS ENUM('resume_generation', 'job_application_tracking', 'cover_letter', 'resume_batch_generation')`,
    );
    await queryRunner.query(
      `CREATE TABLE "rate_limit_configs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan" "public"."rate_limit_configs_plan_enum" NOT NULL, "user_type" "public"."rate_limit_configs_user_type_enum" NOT NULL, "feature_type" "public"."rate_limit_configs_feature_type_enum" NOT NULL, "monthly_limit" integer NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "description" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_b030bece4024127ec07005697da" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_c5674532bcf2890f0cc6381ab0" ON "rate_limit_configs" ("plan", "user_type", "feature_type") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ats_match_histories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "resume_content" text NOT NULL, "job_description" text NOT NULL, "company_name" character varying, "ats_score" double precision NOT NULL, "analysis" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3af70cbbedfe22776f2078f4cac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_employment_type_enum" AS ENUM('full_time', 'part_time', 'contract', 'internship', 'freelance')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_work_mode_enum" AS ENUM('remote', 'hybrid', 'onsite')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_pay_period_enum" AS ENUM('annual', 'monthly', 'hourly')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_status_enum" AS ENUM('wishlist', 'interested', 'applied', 'screening', 'technical_round', 'interviewed', 'offer_received', 'accepted', 'offer_declined', 'rejected', 'withdrawn')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_application_source_enum" AS ENUM('direct_apply', 'tailored_resume')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_job_board_source_enum" AS ENUM('linkedin', 'indeed', 'glassdoor', 'wellfound', 'company_site', 'referral', 'recruiter_outreach', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_applied_via_enum" AS ENUM('easy_apply', 'company_portal', 'email', 'recruiter', 'referral', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_priority_enum" AS ENUM('low', 'medium', 'high', 'top_choice')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_applications_rejection_stage_enum" AS ENUM('auto_rejected', 'after_screening', 'after_interview', 'after_offer_declined', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "job_applications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid, "company_name" character varying(200) NOT NULL, "job_position" character varying(300) NOT NULL, "job_description" text, "job_url" character varying(500), "job_location" character varying(200), "employment_type" "public"."job_applications_employment_type_enum", "work_mode" "public"."job_applications_work_mode_enum", "salary_min" numeric(12,2), "salary_max" numeric(12,2), "salary_currency" character varying(3), "pay_period" "public"."job_applications_pay_period_enum", "salary_negotiable" boolean, "status" "public"."job_applications_status_enum" NOT NULL DEFAULT 'applied', "application_source" "public"."job_applications_application_source_enum" NOT NULL, "job_board_source" "public"."job_applications_job_board_source_enum", "applied_via" "public"."job_applications_applied_via_enum", "priority" "public"."job_applications_priority_enum", "tags" text array, "application_deadline" TIMESTAMP, "applied_at" TIMESTAMP, "decision_deadline" TIMESTAMP, "next_action" character varying(500), "ats_score" double precision, "ats_analysis" jsonb, "ats_match_history_id" uuid, "resume_generation_id" uuid, "resume_content" text, "recruiter_name" character varying(200), "recruiter_email" character varying(200), "recruiter_phone" character varying(20), "hiring_manager_name" character varying(200), "hiring_manager_email" character varying(200), "contact_phone" character varying(20), "contacts" jsonb, "cover_letter" text, "notes" text, "interview_scheduled_at" TIMESTAMP, "interview_notes" text, "follow_up_date" TIMESTAMP, "rejection_stage" "public"."job_applications_rejection_stage_enum", "rejection_reason" text, "rejection_feedback_received" boolean, "compensation_offer" jsonb, "attachments" jsonb, "status_history" jsonb, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c56a5e86707d0f0df18fa111280" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_24aa575a4743e5b82fc4a3d8c1" ON "job_applications" ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_170522f63922c1f73775e85f4e" ON "job_applications" ("user_id", "decision_deadline") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_363ebdd201c3a4df2111b6af52" ON "job_applications" ("user_id", "job_board_source") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1fe6a273fa54d962040a905f2f" ON "job_applications" ("user_id", "work_mode") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_14af70b373e1c59532aee845c6" ON "job_applications" ("user_id", "priority") `,
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
      `CREATE TYPE "public"."job_application_interviews_stage_enum" AS ENUM('recruiter_screen', 'hr_screen', 'take_home', 'technical', 'system_design', 'behavioral', 'hiring_manager', 'onsite_loop', 'final', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_application_interviews_format_enum" AS ENUM('in_person', 'video', 'phone')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."job_application_interviews_outcome_enum" AS ENUM('pending', 'passed', 'failed', 'no_show', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "job_application_interviews" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "job_application_id" uuid NOT NULL, "stage" "public"."job_application_interviews_stage_enum" NOT NULL, "format" "public"."job_application_interviews_format_enum", "outcome" "public"."job_application_interviews_outcome_enum" NOT NULL DEFAULT 'pending', "scheduled_at" TIMESTAMP, "completed_at" TIMESTAMP, "duration_minutes" integer, "interviewer_name" character varying(200), "interviewer_email" character varying(200), "location_or_link" character varying(500), "notes" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2dc0567c511fafe7c9e3ee777bb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90b978bb3b6e06959c0b204a26" ON "job_application_interviews" ("job_application_id", "scheduled_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "enriched_resume_profiles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "extracted_resume_content_id" uuid NOT NULL, "enriched_content" jsonb NOT NULL, "original_content" jsonb NOT NULL, "profile_completeness" double precision NOT NULL DEFAULT '0', "questions_total" integer NOT NULL DEFAULT '0', "questions_answered" integer NOT NULL DEFAULT '0', "version" integer NOT NULL DEFAULT '1', "last_enriched_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f97abdca5c3a2510893a2455796" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_af39a8b3d1b04e855aebeb7d20" ON "enriched_resume_profiles" ("user_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."beta_invites_status_enum" AS ENUM('pending', 'redeemed', 'expired', 'revoked')`,
    );
    await queryRunner.query(
      `CREATE TABLE "beta_invites" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying NOT NULL, "code" character varying(16) NOT NULL, "code_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "status" "public"."beta_invites_status_enum" NOT NULL DEFAULT 'pending', "cohort" character varying(50) NOT NULL DEFAULT 'wave-1', "access_days" smallint NOT NULL DEFAULT '30', "redeemed_at" TIMESTAMP WITH TIME ZONE, "redeemed_by_user_id" uuid, "pro_access_until" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "revoked_reason" character varying(200), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_6a8a6f2d71ead8ed2b767c4db42" UNIQUE ("email"), CONSTRAINT "UQ_e1bd374bf30afc836d4f912ca69" UNIQUE ("code"), CONSTRAINT "PK_34550cd5deca982e538176765cb" PRIMARY KEY ("id"))`,
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
      `ALTER TABLE "payment_history" ADD CONSTRAINT "FK_87a6f5afc86958a2206e337065f" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_history" ADD CONSTRAINT "FK_d4414a3acd094b8e21ca91857d5" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ADD CONSTRAINT "FK_0641da02314913e28f6131310eb" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ADD CONSTRAINT "FK_b6e02561ba40a3798a7e1432f2e" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_tracking" ADD CONSTRAINT "FK_5d8df20d681cd50fcde4db2db32" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_contents" ADD CONSTRAINT "FK_7481d6b5408c4ca8790d27f3f1a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_contents" ADD CONSTRAINT "FK_0bdd6b7b807a4e41f7fcb9fc2b3" FOREIGN KEY ("queue_message_id") REFERENCES "queue_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tailoring_questions" ADD CONSTRAINT "FK_45cf96e8b0dbb02ac6fb10344dd" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "tailoring_questions" ADD CONSTRAINT "FK_0029231ecb39806b85237dc02cb" FOREIGN KEY ("extracted_resume_content_id") REFERENCES "extracted_resume_contents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generation_results" ADD CONSTRAINT "FK_f55e30f1393e8e3a5b597968ca4" FOREIGN KEY ("queue_message_id") REFERENCES "queue_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generation_results" ADD CONSTRAINT "FK_d813c03cd7fff946deb36f826d3" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
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
    await queryRunner.query(
      `ALTER TABLE "job_application_interviews" ADD CONSTRAINT "FK_b5bcedf0f51000e0324db11d4e3" FOREIGN KEY ("job_application_id") REFERENCES "job_applications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enriched_resume_profiles" ADD CONSTRAINT "FK_af39a8b3d1b04e855aebeb7d201" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "enriched_resume_profiles" ADD CONSTRAINT "FK_455d51b6db62fa1f8c3c26e5eef" FOREIGN KEY ("extracted_resume_content_id") REFERENCES "extracted_resume_contents"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "enriched_resume_profiles" DROP CONSTRAINT "FK_455d51b6db62fa1f8c3c26e5eef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "enriched_resume_profiles" DROP CONSTRAINT "FK_af39a8b3d1b04e855aebeb7d201"`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_application_interviews" DROP CONSTRAINT "FK_b5bcedf0f51000e0324db11d4e3"`,
    );
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
      `ALTER TABLE "resume_generation_results" DROP CONSTRAINT "FK_d813c03cd7fff946deb36f826d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generation_results" DROP CONSTRAINT "FK_f55e30f1393e8e3a5b597968ca4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tailoring_questions" DROP CONSTRAINT "FK_0029231ecb39806b85237dc02cb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tailoring_questions" DROP CONSTRAINT "FK_45cf96e8b0dbb02ac6fb10344dd"`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_contents" DROP CONSTRAINT "FK_0bdd6b7b807a4e41f7fcb9fc2b3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_contents" DROP CONSTRAINT "FK_7481d6b5408c4ca8790d27f3f1a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_tracking" DROP CONSTRAINT "FK_5d8df20d681cd50fcde4db2db32"`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_52ac39dd8a28730c63aeb428c9c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" DROP CONSTRAINT "FK_b6e02561ba40a3798a7e1432f2e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" DROP CONSTRAINT "FK_0641da02314913e28f6131310eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_history" DROP CONSTRAINT "FK_d4414a3acd094b8e21ca91857d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_history" DROP CONSTRAINT "FK_87a6f5afc86958a2206e337065f"`,
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
    await queryRunner.query(`DROP TABLE "beta_invites"`);
    await queryRunner.query(`DROP TYPE "public"."beta_invites_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af39a8b3d1b04e855aebeb7d20"`,
    );
    await queryRunner.query(`DROP TABLE "enriched_resume_profiles"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90b978bb3b6e06959c0b204a26"`,
    );
    await queryRunner.query(`DROP TABLE "job_application_interviews"`);
    await queryRunner.query(
      `DROP TYPE "public"."job_application_interviews_outcome_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_application_interviews_format_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_application_interviews_stage_enum"`,
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
      `DROP INDEX "public"."IDX_14af70b373e1c59532aee845c6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1fe6a273fa54d962040a905f2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_363ebdd201c3a4df2111b6af52"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_170522f63922c1f73775e85f4e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_24aa575a4743e5b82fc4a3d8c1"`,
    );
    await queryRunner.query(`DROP TABLE "job_applications"`);
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_rejection_stage_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_priority_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_applied_via_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_job_board_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_application_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_pay_period_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_work_mode_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."job_applications_employment_type_enum"`,
    );
    await queryRunner.query(`DROP TABLE "ats_match_histories"`);
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
      `DROP INDEX "public"."IDX_d813c03cd7fff946deb36f826d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f55e30f1393e8e3a5b597968ca"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1242dbe804f4f4e627cb5be072"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d0eec62f5cd1dbf361cda778b"`,
    );
    await queryRunner.query(`DROP TABLE "resume_generation_results"`);
    await queryRunner.query(`DROP TABLE "tailoring_questions"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7481d6b5408c4ca8790d27f3f1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_177e1d803446238c7aa73cc966"`,
    );
    await queryRunner.query(`DROP TABLE "extracted_resume_contents"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_533139149603462e5c6b8dea3b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_74a9bd9e701c0a8ad8aa9e270d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e55a8b06acc50b03ec17c262d8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ab763366ae0852f4a5981b39e1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d9817181e2aec29462a1ac0265"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_55ff14f135000b8fd3c64fe6ec"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73fa506e7d32c6689624270f0f"`,
    );
    await queryRunner.query(`DROP TABLE "queue_messages"`);
    await queryRunner.query(
      `DROP TYPE "public"."queue_messages_priority_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."queue_messages_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4c8f4f5a55135dece756b70f2f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_df86c9490cd1a45431d9612d6b"`,
    );
    await queryRunner.query(`DROP TABLE "usage_tracking"`);
    await queryRunner.query(
      `DROP TYPE "public"."usage_tracking_feature_type_enum"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(
      `DROP TYPE "public"."users_registration_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_user_type_enum"`);
    await queryRunner.query(`DROP TYPE "public"."users_plan_enum"`);
    await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cf427b0b12e1b2ee93a64328e1"`,
    );
    await queryRunner.query(`DROP TABLE "user_subscriptions"`);
    await queryRunner.query(
      `DROP TYPE "public"."user_subscriptions_status_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_608aeb4a0ed13553b4c4838501"`,
    );
    await queryRunner.query(`DROP TABLE "subscription_plans"`);
    await queryRunner.query(
      `DROP TYPE "public"."subscription_plans_billing_cycle_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_87a6f5afc86958a2206e337065"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_16ab451b0242ee468a05bf72a5"`,
    );
    await queryRunner.query(`DROP TABLE "payment_history"`);
    await queryRunner.query(
      `DROP TYPE "public"."payment_history_payment_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "public"."payment_history_status_enum"`);
    await queryRunner.query(`DROP TABLE "user_resumes"`);
    await queryRunner.query(`DROP TABLE "resume_generations"`);
    await queryRunner.query(`DROP TABLE "resume_templates"`);
  }
}
