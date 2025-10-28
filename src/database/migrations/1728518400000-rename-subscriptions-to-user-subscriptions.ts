import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameSubscriptionsToUserSubscriptions1728518400000
  implements MigrationInterface
{
  name = 'RenameSubscriptionsToUserSubscriptions1728518400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename the table from 'subscriptions' to 'user_subscriptions'
    await queryRunner.query(
      `ALTER TABLE "subscriptions" RENAME TO "user_subscriptions"`,
    );

    // Update constraint names to reflect the new table name
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME CONSTRAINT "PK_subscriptions" TO "PK_user_subscriptions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME CONSTRAINT "UQ_subscriptions_lemon_squeezy_id" TO "UQ_user_subscriptions_lemon_squeezy_id"`,
    );

    // Update foreign key constraint names if they exist
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME CONSTRAINT "FK_subscriptions_user_id" TO "FK_user_subscriptions_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME CONSTRAINT "FK_subscriptions_subscription_plan_id" TO "FK_user_subscriptions_subscription_plan_id"`,
    );

    // Update enum type name if it exists
    await queryRunner.query(
      `ALTER TYPE "subscriptions_status_enum" RENAME TO "user_subscriptions_status_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert enum type name
    await queryRunner.query(
      `ALTER TYPE "user_subscriptions_status_enum" RENAME TO "subscriptions_status_enum"`,
    );

    // Revert foreign key constraint names
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME CONSTRAINT "FK_user_subscriptions_subscription_plan_id" TO "FK_subscriptions_subscription_plan_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME CONSTRAINT "FK_user_subscriptions_user_id" TO "FK_subscriptions_user_id"`,
    );

    // Revert constraint names
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME CONSTRAINT "UQ_user_subscriptions_lemon_squeezy_id" TO "UQ_subscriptions_lemon_squeezy_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME CONSTRAINT "PK_user_subscriptions" TO "PK_subscriptions"`,
    );

    // Rename the table back to 'subscriptions'
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME TO "subscriptions"`,
    );
  }
}
