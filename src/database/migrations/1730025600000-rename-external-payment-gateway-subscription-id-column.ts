import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameExternalPaymentGatewaySubscriptionIdColumn1730025600000
  implements MigrationInterface
{
  name = 'RenameExternalPaymentGatewaySubscriptionIdColumn1730025600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop existing unique constraint if exists
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "UQ_user_subscriptions_external_payment_gateway_subscription_id"`,
    );

    // Drop existing index if exists
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_subscriptions_external_payment_gateway_subscription_id"`,
    );

    // Rename column from external_payment_gateway_subscription_id to payment_gateway_subscription_id
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME COLUMN "external_payment_gateway_subscription_id" TO "payment_gateway_subscription_id"`,
    );

    // Create new index on the renamed column
    await queryRunner.query(
      `CREATE INDEX "IDX_user_subscriptions_payment_gateway_subscription_id" ON "user_subscriptions" ("payment_gateway_subscription_id")`,
    );

    // Add unique constraint on the renamed column
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ADD CONSTRAINT "UQ_user_subscriptions_payment_gateway_subscription_id" UNIQUE ("payment_gateway_subscription_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop new unique constraint
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "UQ_user_subscriptions_payment_gateway_subscription_id"`,
    );

    // Drop new index
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_subscriptions_payment_gateway_subscription_id"`,
    );

    // Rename column back to external_payment_gateway_subscription_id
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" RENAME COLUMN "payment_gateway_subscription_id" TO "external_payment_gateway_subscription_id"`,
    );

    // Recreate old index
    await queryRunner.query(
      `CREATE INDEX "IDX_user_subscriptions_external_payment_gateway_subscription_id" ON "user_subscriptions" ("external_payment_gateway_subscription_id")`,
    );

    // Recreate old unique constraint
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ADD CONSTRAINT "UQ_user_subscriptions_external_payment_gateway_subscription_id" UNIQUE ("external_payment_gateway_subscription_id")`,
    );
  }
}