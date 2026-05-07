import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterTailoringQuestionsAddProfileColumns1762793055000 implements MigrationInterface {
  name = 'AlterTailoringQuestionsAddProfileColumns1762793055000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ALTER COLUMN "session_id" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ADD COLUMN "user_id" uuid,
      ADD COLUMN "extracted_resume_content_id" uuid,
      ADD COLUMN "source" character varying(20) NOT NULL DEFAULT 'session'
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ADD CONSTRAINT "FK_tailoring_questions_user"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ADD CONSTRAINT "FK_tailoring_questions_extracted_resume_content"
      FOREIGN KEY ("extracted_resume_content_id")
      REFERENCES "extracted_resume_contents"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_tailoring_questions_user_source_answered"
      ON "tailoring_questions" ("user_id", "source", "is_answered")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_tailoring_questions_user_source_answered"
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      DROP CONSTRAINT "FK_tailoring_questions_extracted_resume_content"
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      DROP CONSTRAINT "FK_tailoring_questions_user"
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      DROP COLUMN "source",
      DROP COLUMN "extracted_resume_content_id",
      DROP COLUMN "user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "tailoring_questions"
      ALTER COLUMN "session_id" SET NOT NULL
    `);
  }
}
