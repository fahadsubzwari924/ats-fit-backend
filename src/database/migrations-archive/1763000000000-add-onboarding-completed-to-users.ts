import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingCompletedToUsers1763000000000 implements MigrationInterface {
  name = 'AddOnboardingCompletedToUsers1763000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // New column with default false for new users
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "onboarding_completed" boolean NOT NULL DEFAULT false`,
    );

    // Mark existing users as having completed onboarding so they are not forced through it
    await queryRunner.query(
      `UPDATE "users" SET "onboarding_completed" = true WHERE "onboarding_completed" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "onboarding_completed"`,
    );
  }
}
