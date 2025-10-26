import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameExternalSubscriptionIdToExternalPaymentGatewaySubscriptionId1729160000000
  implements MigrationInterface
{
  name =
    'RenameExternalSubscriptionIdToExternalPaymentGatewaySubscriptionId1729160000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if the old column exists before renaming
    const hasOldColumn = await queryRunner.hasColumn(
      'user_subscriptions',
      'external_subscription_id',
    );

    if (hasOldColumn) {
      // Rename the column from external_subscription_id to external_payment_gateway_subscription_id
      await queryRunner.query(
        `ALTER TABLE "user_subscriptions" RENAME COLUMN "external_subscription_id" TO "external_payment_gateway_subscription_id"`,
      );

      // Update the index
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_user_subscriptions_external_subscription_id"`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_user_subscriptions_external_payment_gateway_subscription_id" ON "user_subscriptions" ("external_payment_gateway_subscription_id")`,
      );

      // Update unique constraints if they exist
      await queryRunner.query(
        `ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "UQ_user_subscriptions_external_subscription_id"`,
      );
      await queryRunner.query(
        `ALTER TABLE "user_subscriptions" ADD CONSTRAINT "UQ_user_subscriptions_external_payment_gateway_subscription_id" UNIQUE ("external_payment_gateway_subscription_id")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Check if the new column exists before reverting
    const hasNewColumn = await queryRunner.hasColumn(
      'user_subscriptions',
      'external_payment_gateway_subscription_id',
    );

    if (hasNewColumn) {
      // Revert unique constraints
      await queryRunner.query(
        `ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "UQ_user_subscriptions_external_payment_gateway_subscription_id"`,
      );
      await queryRunner.query(
        `ALTER TABLE "user_subscriptions" ADD CONSTRAINT "UQ_user_subscriptions_external_subscription_id" UNIQUE ("external_subscription_id")`,
      );

      // Revert the index
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_user_subscriptions_external_payment_gateway_subscription_id"`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_user_subscriptions_external_subscription_id" ON "user_subscriptions" ("external_subscription_id")`,
      );

      // Revert the column name
      await queryRunner.query(
        `ALTER TABLE "user_subscriptions" RENAME COLUMN "external_payment_gateway_subscription_id" TO "external_subscription_id"`,
      );
    }
  }
}
