import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds JOB_RELEVANCE_SCORE as a first-class metered feature.
 *
 * Quota model — Approach F (shared pool, graceful degradation):
 *   FREEMIUM / job_relevance_score → 10 per month
 *   PREMIUM  / job_relevance_score → 100 per month
 *   (Guests are blocked at the route guard; no DB seed row needed — the user_type enum only contains 'registered'.)
 *
 * Both the standalone POST /resume-tailoring/relevance endpoint AND the
 * orchestrator's internal call (inside generateOptimizedResume) consume
 * from this pool. Cache hits are free (no LLM call → service skips
 * recordUsage). When exhausted, the orchestrator returns the existing
 * UNAVAILABLE verdict sentinel with reason QUOTA_EXHAUSTED so the FE can
 * skip the Job Fit step in the stepper without blocking tailoring.
 */
export class AddJobRelevanceScoreFeatureType1815200000000 implements MigrationInterface {
  name = 'AddJobRelevanceScoreFeatureType1815200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Phase 1: commit TypeORM's open transaction so ALTER TYPE can run
    //          (Postgres requires enum extensions to live outside any TX).
    await queryRunner.commitTransaction();

    await queryRunner.query(
      `ALTER TYPE "public"."usage_tracking_feature_type_enum" ADD VALUE IF NOT EXISTS 'job_relevance_score'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."rate_limit_configs_feature_type_enum" ADD VALUE IF NOT EXISTS 'job_relevance_score'`,
    );

    // Phase 2: open a fresh transaction for the seed INSERTs.
    await queryRunner.startTransaction();

    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('freemium', 'registered', 'job_relevance_score', 10, true, 'Job-fit relevance previews for freemium users')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );
    await queryRunner.query(
      `INSERT INTO "rate_limit_configs" ("plan", "user_type", "feature_type", "monthly_limit", "is_active", "description")
       VALUES ('premium', 'registered', 'job_relevance_score', 100, true, 'Job-fit relevance previews for premium users')
       ON CONFLICT ("plan", "user_type", "feature_type") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "rate_limit_configs" WHERE "feature_type" = 'job_relevance_score'`,
    );
    // NOTE: PostgreSQL does not support DROP VALUE on an enum.
    // The 'job_relevance_score' value remains in the enum types after rollback;
    // this is harmless — orphan enum values do not affect existing rows.
  }
}
