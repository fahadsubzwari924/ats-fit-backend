import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoverLetterFeatureType1762793059000 implements MigrationInterface {
  name = 'AddCoverLetterFeatureType1762793059000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL requires ALTER TYPE ADD VALUE to be committed before the new
    // value can be used in the same session. We must commit the current
    // transaction, run the ALTER TYPE statements (they auto-commit), then
    // start a fresh transaction for the subsequent INSERTs.

    // Phase 1: commit the TypeORM-opened transaction so ALTER TYPE can run
    await queryRunner.commitTransaction();

    // Phase 2: add enum values outside any transaction (they are DDL and
    // take effect immediately once committed)
    await queryRunner.query(
      `ALTER TYPE "public"."usage_tracking_feature_type_enum" ADD VALUE IF NOT EXISTS 'cover_letter'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."rate_limit_configs_feature_type_enum" ADD VALUE IF NOT EXISTS 'cover_letter'`,
    );

    // Phase 3: open a new transaction for the DML inserts — TypeORM's
    // MigrationExecutor will commit this transaction after up() returns
    await queryRunner.startTransaction();

    // Freemium registered: 3/month
    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('freemium', 'registered', 'cover_letter', 3, true, 'Cover letter generation for freemium users')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );

    // Premium registered: 30/month
    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('premium', 'registered', 'cover_letter', 30, true, 'Cover letter generation for premium users')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );

    // Guest: 0 (not available)
    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('freemium', 'guest', 'cover_letter', 0, true, 'Cover letter generation for guest users (not available)')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "rate_limit_configs" WHERE "feature_type" = 'cover_letter'`,
    );
    // NOTE: PostgreSQL does not support DROP VALUE on an enum.
    // The 'cover_letter' value will remain in the enum types after rollback.
  }
}
