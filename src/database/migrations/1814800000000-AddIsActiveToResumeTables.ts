import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsActiveToResumeTables1814800000000 implements MigrationInterface {
  name = 'AddIsActiveToResumeTables1814800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add columns to extracted_resume_contents
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_contents" ADD "is_active" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_contents" ADD "archived_at" TIMESTAMP WITH TIME ZONE`,
    );

    // 2. Backfill: keep newest per user, archive rest
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn,
               updated_at
        FROM extracted_resume_contents
      )
      UPDATE extracted_resume_contents e
      SET is_active = false, archived_at = ranked.updated_at
      FROM ranked
      WHERE e.id = ranked.id AND ranked.rn > 1
    `);

    // 3. Drop existing global unique on file_hash if present (handles any constraint name)
    await queryRunner.query(`
      DO $$
      DECLARE constraint_name TEXT;
      BEGIN
        SELECT conname INTO constraint_name
        FROM pg_constraint
        WHERE conrelid = 'extracted_resume_contents'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) LIKE '%file_hash%';
        IF constraint_name IS NOT NULL THEN
          EXECUTE format('ALTER TABLE extracted_resume_contents DROP CONSTRAINT %I', constraint_name);
        END IF;
      END$$;
    `);

    // 4. Partial unique: one active extract per user
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_extracted_resume_contents_user_active"
      ON "extracted_resume_contents" ("user_id")
      WHERE "is_active" = true
    `);

    // 5. Partial unique: one active hash per user (allows archived duplicates)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_extracted_resume_contents_user_filehash_active"
      ON "extracted_resume_contents" ("user_id", "file_hash")
      WHERE "is_active" = true
    `);

    // 6. user_resumes already has "isActive" column from InitialSchema.
    //    Only add archived_at and update backfill using existing "isActive".
    await queryRunner.query(
      `ALTER TABLE "user_resumes" ADD "archived_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY "createdAt" DESC) AS rn,
               "updatedAt"
        FROM user_resumes
      )
      UPDATE user_resumes r
      SET "isActive" = false, archived_at = ranked."updatedAt"
      FROM ranked
      WHERE r.id = ranked.id AND ranked.rn > 1
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_user_resumes_user_active"
      ON "user_resumes" ("user_id")
      WHERE "isActive" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_resumes_user_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_resumes" DROP COLUMN "archived_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_extracted_resume_contents_user_filehash_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_extracted_resume_contents_user_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_contents" DROP COLUMN "archived_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "extracted_resume_contents" DROP COLUMN "is_active"`,
    );
  }
}
