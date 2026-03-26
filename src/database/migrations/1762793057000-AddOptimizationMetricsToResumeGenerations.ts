import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOptimizationMetricsToResumeGenerations1762793057000
  implements MigrationInterface
{
  name = 'AddOptimizationMetricsToResumeGenerations1762793057000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "job_position" VARCHAR(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "keywords_added" INT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "sections_optimized" INT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "achievements_quantified" INT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "optimization_confidence" FLOAT`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "pdf_s3_key" VARCHAR(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "pdf_s3_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "optimization_confidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "achievements_quantified"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "sections_optimized"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "keywords_added"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "job_position"`,
    );
  }
}
