import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes legacy per-job tailoring sessions. Profile questions are the only flow;
 * tailoring_questions rows are scoped by user_id + extracted_resume_content_id only.
 */
export class DropTailoringSessionsRemoveSessionId1762800000000 implements MigrationInterface {
  name = 'DropTailoringSessionsRemoveSessionId1762800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "tailoring_questions"
      WHERE "session_id" IS NOT NULL OR "source" = 'session'
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      DROP CONSTRAINT IF EXISTS "FK_tailoring_questions_session"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_tailoring_questions_session_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions" DROP COLUMN IF EXISTS "session_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ALTER COLUMN "source" SET DEFAULT 'profile'
    `);

    await queryRunner.query(`
      UPDATE "tailoring_questions" SET "source" = 'profile' WHERE "source" <> 'profile'
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_tailoring_sessions_created_at"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_tailoring_sessions_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_tailoring_sessions_guest_id"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_tailoring_sessions_user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_sessions"
      DROP CONSTRAINT IF EXISTS "FK_tailoring_sessions_user"
    `);

    await queryRunner.query(`DROP TABLE IF EXISTS "tailoring_sessions"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tailoring_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid,
        "guest_id" character varying(255),
        "resume_id" uuid,
        "job_position" character varying(100) NOT NULL,
        "company_name" character varying(100) NOT NULL,
        "job_description" text NOT NULL,
        "template_id" uuid NOT NULL,
        "status" character varying(50) NOT NULL DEFAULT 'created',
        "resume_file_name" character varying(255),
        "resume_file_size" integer,
        "resume_content" text,
        "questions_generated_at" TIMESTAMP,
        "responses_submitted_at" TIMESTAMP,
        "resume_generation_completed_at" TIMESTAMP,
        "queue_message_id" uuid,
        "result_metadata" jsonb,
        "error_message" text,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tailoring_sessions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_sessions"
      ADD CONSTRAINT "FK_tailoring_sessions_user"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_sessions_user_id" ON "tailoring_sessions" ("user_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_sessions_guest_id" ON "tailoring_sessions" ("guest_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_sessions_status" ON "tailoring_sessions" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_sessions_created_at" ON "tailoring_sessions" ("created_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ADD COLUMN "session_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ADD CONSTRAINT "FK_tailoring_questions_session"
      FOREIGN KEY ("session_id") REFERENCES "tailoring_sessions"("id")
      ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_questions_session_id" ON "tailoring_questions" ("session_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ALTER COLUMN "source" SET DEFAULT 'session'
    `);
  }
}
