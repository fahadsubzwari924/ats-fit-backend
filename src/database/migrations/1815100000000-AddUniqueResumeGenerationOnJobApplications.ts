import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the partial unique index that `JobApplicationService.trackTailoringApplication`
 * relies on for idempotency.
 *
 * DEPLOYER PRE-FLIGHT — run before applying in production to catch any
 * pre-existing duplicate `(resume_generation_id)` rows that would cause
 * `CREATE UNIQUE INDEX` to fail:
 *
 *   SELECT resume_generation_id, COUNT(*)
 *   FROM job_applications
 *   WHERE resume_generation_id IS NOT NULL
 *   GROUP BY resume_generation_id
 *   HAVING COUNT(*) > 1;
 *
 * If that query returns any rows, decide per-row which `job_applications`
 * record to keep before running this migration.
 */
export class AddUniqueResumeGenerationOnJobApplications1815100000000 implements MigrationInterface {
  name = 'AddUniqueResumeGenerationOnJobApplications1815100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applications_resume_generation_id
        ON job_applications (resume_generation_id)
        WHERE resume_generation_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_job_applications_resume_generation_id`,
    );
  }
}
