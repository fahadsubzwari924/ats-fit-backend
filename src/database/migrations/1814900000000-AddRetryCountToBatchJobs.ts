import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRetryCountToBatchJobs1814900000000 implements MigrationInterface {
  name = 'AddRetryCountToBatchJobs1814900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "batch_tailoring_jobs" ADD "retry_count" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "batch_tailoring_jobs" DROP COLUMN "retry_count"`,
    );
  }
}
