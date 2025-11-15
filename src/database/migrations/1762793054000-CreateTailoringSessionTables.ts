import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTailoringSessionTables1762793054000
  implements MigrationInterface
{
  name = 'CreateTailoringSessionTables1762793054000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create tailoring_sessions table
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

    // Create tailoring_questions table
    await queryRunner.query(`
      CREATE TABLE "tailoring_questions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "session_id" uuid NOT NULL,
        "work_experience_index" integer NOT NULL,
        "bullet_point_index" integer NOT NULL,
        "original_bullet_point" text NOT NULL,
        "question_text" text NOT NULL,
        "question_category" character varying(50) NOT NULL,
        "user_response" text,
        "is_answered" boolean NOT NULL DEFAULT false,
        "order_index" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tailoring_questions" PRIMARY KEY ("id")
      )
    `);

    // Add foreign keys
    await queryRunner.query(`
      ALTER TABLE "tailoring_sessions"
      ADD CONSTRAINT "FK_tailoring_sessions_user"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE NO ACTION
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ADD CONSTRAINT "FK_tailoring_questions_session"
      FOREIGN KEY ("session_id")
      REFERENCES "tailoring_sessions"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    // Create indexes
    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_sessions_user_id"
      ON "tailoring_sessions" ("user_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_sessions_guest_id"
      ON "tailoring_sessions" ("guest_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_sessions_status"
      ON "tailoring_sessions" ("status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_questions_session_id"
      ON "tailoring_questions" ("session_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_sessions_created_at"
      ON "tailoring_sessions" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`DROP INDEX "IDX_tailoring_sessions_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_tailoring_questions_session_id"`);
    await queryRunner.query(`DROP INDEX "IDX_tailoring_sessions_status"`);
    await queryRunner.query(`DROP INDEX "IDX_tailoring_sessions_guest_id"`);
    await queryRunner.query(`DROP INDEX "IDX_tailoring_sessions_user_id"`);

    // Drop foreign keys
    await queryRunner.query(
      `ALTER TABLE "tailoring_questions" DROP CONSTRAINT "FK_tailoring_questions_session"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tailoring_sessions" DROP CONSTRAINT "FK_tailoring_sessions_user"`,
    );

    // Drop tables
    await queryRunner.query(`DROP TABLE "tailoring_questions"`);
    await queryRunner.query(`DROP TABLE "tailoring_sessions"`);
  }
}
