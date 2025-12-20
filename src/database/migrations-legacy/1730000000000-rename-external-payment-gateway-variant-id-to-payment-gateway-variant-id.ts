import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameExternalPaymentGatewayVariantIdToPaymentGatewayVariantId1730000000000
  implements MigrationInterface
{
  name = 'RenameExternalPaymentGatewayVariantIdToPaymentGatewayVariantId1730000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the existing unique constraint first
    await queryRunner.query(
      `ALTER TABLE "subscription_plans" DROP CONSTRAINT IF EXISTS "UQ_subscription_plans_external_payment_gateway_variant_id"`,
    );

    // Drop the existing index
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_plans_external_payment_gateway_variant_id"`,
    );

    // Rename the column from external_payment_gateway_variant_id to payment_gateway_variant_id
    await queryRunner.query(
      `ALTER TABLE "subscription_plans" RENAME COLUMN "external_payment_gateway_variant_id" TO "payment_gateway_variant_id"`,
    );

    // Create new unique index for the renamed column
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subscription_plans_payment_gateway_variant_id" ON "subscription_plans" ("payment_gateway_variant_id")`,
    );

    // Add unique constraint for the renamed column
    await queryRunner.query(
      `ALTER TABLE "subscription_plans" ADD CONSTRAINT "UQ_subscription_plans_payment_gateway_variant_id" UNIQUE ("payment_gateway_variant_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the new unique constraint
    await queryRunner.query(
      `ALTER TABLE "subscription_plans" DROP CONSTRAINT IF EXISTS "UQ_subscription_plans_payment_gateway_variant_id"`,
    );

    // Drop the new index
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_subscription_plans_payment_gateway_variant_id"`,
    );

    // Rename the column back from payment_gateway_variant_id to external_payment_gateway_variant_id
    await queryRunner.query(
      `ALTER TABLE "subscription_plans" RENAME COLUMN "payment_gateway_variant_id" TO "external_payment_gateway_variant_id"`,
    );

    // Recreate the original unique index
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_subscription_plans_external_payment_gateway_variant_id" ON "subscription_plans" ("external_payment_gateway_variant_id")`,
    );

    // Recreate the original unique constraint
    await queryRunner.query(
      `ALTER TABLE "subscription_plans" ADD CONSTRAINT "UQ_subscription_plans_external_payment_gateway_variant_id" UNIQUE ("external_payment_gateway_variant_id")`,
    );
  }
}