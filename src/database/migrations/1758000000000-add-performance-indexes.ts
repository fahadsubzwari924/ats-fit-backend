import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1758000000000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1758000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ESSENTIAL INDEXES ONLY - Based on actual V2 resume generation query patterns

    // 1. Critical composite index for resume selection queries
    // This supports: SELECT * FROM extracted_resume_contents WHERE user_id = ? ORDER BY created_at DESC LIMIT 1
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_extracted_resume_userId_createdAt" ON "extracted_resume_contents" ("user_id", "created_at" DESC)`,
    );

    // 2. Essential indexes for user_resumes table
    // Supports: WHERE user_id = ? AND isActive = true
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_resumes_user_active" ON "user_resumes" ("user_id", "isActive")`,
    );

    // 3. Index for resume lookups by ID and active status
    // Supports: WHERE id = ? AND isActive = true
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_resumes_id_active" ON "user_resumes" ("id", "isActive")`,
    );

    // 4. Essential index for resume templates
    // Supports: SELECT * FROM resume_templates WHERE key = ?
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_resume_templates_key" ON "resume_templates" ("key")`,
    );

    // 5. Index for ATS match history lookups by user (most common query pattern)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ats_match_histories_user_id" ON "ats_match_histories" ("user_id")`,
    );

    // 6. Index for resume generations by user for tracking
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_resume_generations_user_created" ON "resume_generations" ("user_id", "created_at" DESC)`,
    );

    // 7. Index for resume generation lookups by ID (used in job applications)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_resume_generations_id" ON "resume_generations" ("id")`,
    );

    // 8. Users: For guest user lookups (rate limiting and tracking)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_guest_id" ON "users" ("guest_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop all indexes we created (in reverse order)
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_guest_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_resume_generations_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_resume_generations_user_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_ats_match_histories_user_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_resume_templates_key"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_resumes_id_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_resumes_user_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_extracted_resume_userId_createdAt"`,
    );
  }
}
