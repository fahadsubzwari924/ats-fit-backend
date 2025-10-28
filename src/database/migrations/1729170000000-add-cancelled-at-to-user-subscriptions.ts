import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelledAtToUserSubscriptions1729170000000
  implements MigrationInterface
{
  name = 'AddCancelledAtToUserSubscriptions1729170000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the cancelled_at column to user_subscriptions table
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ADD "cancelled_at" TIMESTAMP`,
    );

    // Add index for cancelled_at column for efficient querying
    await queryRunner.query(
      `CREATE INDEX "IDX_user_subscriptions_cancelled_at" ON "user_subscriptions" ("cancelled_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the index first
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_subscriptions_cancelled_at"`,
    );

    // Remove the cancelled_at column from user_subscriptions table
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" DROP COLUMN "cancelled_at"`,
    );
  }
}
