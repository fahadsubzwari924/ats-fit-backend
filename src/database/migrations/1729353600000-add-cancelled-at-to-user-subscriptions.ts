import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelledAtToUserSubscriptions1729353600000
  implements MigrationInterface
{
  name = 'AddCancelledAtToUserSubscriptions1729353600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if cancelled_at column exists before adding it
    const hasCancelledAt = await queryRunner.hasColumn(
      'user_subscriptions',
      'cancelled_at',
    );

    if (!hasCancelledAt) {
      // Add cancelled_at column to user_subscriptions table
      await queryRunner.query(`
        ALTER TABLE "user_subscriptions" 
        ADD COLUMN "cancelled_at" TIMESTAMP NULL
      `);
    }

    // Add index on cancelled_at column for better query performance (only if it doesn't exist)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_subscriptions_cancelled_at" 
      ON "user_subscriptions" ("cancelled_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the index first (if it exists)
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_user_subscriptions_cancelled_at"
    `);

    // Check if cancelled_at column exists before dropping it
    const hasCancelledAt = await queryRunner.hasColumn(
      'user_subscriptions',
      'cancelled_at',
    );

    if (hasCancelledAt) {
      // Drop the cancelled_at column
      await queryRunner.query(`
        ALTER TABLE "user_subscriptions" 
        DROP COLUMN "cancelled_at"
      `);
    }
  }
}
