import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelledAtToUserSubscriptions1729353600000 implements MigrationInterface {
  name = 'AddCancelledAtToUserSubscriptions1729353600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add cancelled_at column to user_subscriptions table
    await queryRunner.query(`
      ALTER TABLE "user_subscriptions" 
      ADD COLUMN "cancelled_at" TIMESTAMP NULL
    `);

    // Add index on cancelled_at column for better query performance
    await queryRunner.query(`
      CREATE INDEX "IDX_user_subscriptions_cancelled_at" 
      ON "user_subscriptions" ("cancelled_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the index first
    await queryRunner.query(`
      DROP INDEX "IDX_user_subscriptions_cancelled_at"
    `);

    // Drop the cancelled_at column
    await queryRunner.query(`
      ALTER TABLE "user_subscriptions" 
      DROP COLUMN "cancelled_at"
    `);
  }
}