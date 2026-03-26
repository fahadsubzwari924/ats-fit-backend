import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBatchGenerateFeatureType1762793060000
  implements MigrationInterface
{
  name = 'AddBatchGenerateFeatureType1762793060000';

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
      `ALTER TYPE "public"."usage_tracking_feature_type_enum" ADD VALUE IF NOT EXISTS 'resume_batch_generation'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."rate_limit_configs_feature_type_enum" ADD VALUE IF NOT EXISTS 'resume_batch_generation'`,
    );

    // Phase 3: open a new transaction for the DML inserts — TypeORM's
    // MigrationExecutor will commit this transaction after up() returns
    await queryRunner.startTransaction();

    // Freemium registered: not available (0/month)
    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('freemium', 'registered', 'resume_batch_generation', 0, true, 'Batch resume generation for freemium users (not available)')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );

    // Premium registered: 5 batches/month
    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('premium', 'registered', 'resume_batch_generation', 5, true, 'Batch resume generation for premium users (5 batches/month, up to 10 jobs each)')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );

    // Guest: not available (0/month)
    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('freemium', 'guest', 'resume_batch_generation', 0, true, 'Batch resume generation for guest users (not available)')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "rate_limit_configs" WHERE "feature_type" = 'resume_batch_generation'`,
    );
    // NOTE: PostgreSQL does not support DROP VALUE on an enum.
    // The 'resume_batch_generation' value will remain in the enum types after rollback.
  }
}
