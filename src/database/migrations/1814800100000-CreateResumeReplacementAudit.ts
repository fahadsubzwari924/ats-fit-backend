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
          FOREIGN KEY ("archived_extract_id") REFERENCES "extracted_resume_contents"("id") ON DELETE SET NULL,
        CONSTRAINT "fk_resume_replacement_audit_new_extract"
          FOREIGN KEY ("new_extract_id") REFERENCES "extracted_resume_contents"("id") ON DELETE SET NULL
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
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_resume_replacement_audit_idempotency"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_resume_replacement_audit_user_attempted"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "resume_replacement_audit"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "resume_replacement_kind"`);
  }
}
