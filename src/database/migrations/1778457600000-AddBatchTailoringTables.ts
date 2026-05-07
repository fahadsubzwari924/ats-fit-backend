import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBatchTailoringTables1778457600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "batch_tailoring_runs" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "user_id" UUID NOT NULL,
        "template_id" UUID,
        "resume_id" UUID,
        "total_jobs" INTEGER NOT NULL,
        "completed_jobs" INTEGER NOT NULL DEFAULT 0,
        "failed_jobs" INTEGER NOT NULL DEFAULT 0,
        "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
        "last_event_id" INTEGER NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_batch_runs_user"
      ON "batch_tailoring_runs" ("user_id", "created_at" DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE "batch_tailoring_jobs" (
        "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        "batch_id" UUID NOT NULL REFERENCES "batch_tailoring_runs"("id") ON DELETE CASCADE,
        "job_index" INTEGER NOT NULL,
        "job_position" VARCHAR(255) NOT NULL,
        "company_name" VARCHAR(255) NOT NULL,
        "job_description" TEXT NOT NULL,
        "state" VARCHAR(20) NOT NULL DEFAULT 'queued',
        "resume_generation_id" UUID REFERENCES "resume_generations"("id"),
        "error_message" TEXT,
        "started_at" TIMESTAMP,
        "completed_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "uq_batch_job_index" UNIQUE ("batch_id", "job_index")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_batch_jobs_batch"
      ON "batch_tailoring_jobs" ("batch_id", "job_index")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_batch_jobs_batch"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "batch_tailoring_jobs"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_batch_runs_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "batch_tailoring_runs"`);
  }
}
