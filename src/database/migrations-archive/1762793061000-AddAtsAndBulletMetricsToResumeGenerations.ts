import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAtsAndBulletMetricsToResumeGenerations1762793061000 implements MigrationInterface {
  name = 'AddAtsAndBulletMetricsToResumeGenerations1762793061000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "ats_checks_passed" INT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "ats_checks_total" INT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "bullets_quantified_before" INT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "bullets_quantified_after" INT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "match_score_before" FLOAT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "match_score_after" FLOAT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "match_score_after"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "match_score_before"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "bullets_quantified_after"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "bullets_quantified_before"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "ats_checks_total"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "ats_checks_passed"`,
    );
  }
}
