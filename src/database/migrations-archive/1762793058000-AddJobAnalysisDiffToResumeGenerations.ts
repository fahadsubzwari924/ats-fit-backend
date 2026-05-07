import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobAnalysisDiffToResumeGenerations1762793058000 implements MigrationInterface {
  name = 'AddJobAnalysisDiffToResumeGenerations1762793058000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "job_analysis" JSONB`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "candidate_content" JSONB`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "changes_diff" JSONB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "changes_diff"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "candidate_content"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "job_analysis"`,
    );
  }
}
