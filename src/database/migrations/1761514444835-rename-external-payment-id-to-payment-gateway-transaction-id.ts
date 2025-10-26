import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameExternalPaymentIdToPaymentGatewayTransactionId1761514444835
  implements MigrationInterface
{
  name = 'RenameExternalPaymentIdToPaymentGatewayTransactionId1761514444835';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if the column exists before renaming
    const hasExternalPaymentId = await queryRunner.hasColumn(
      'payment_history',
      'external_payment_id',
    );

    if (hasExternalPaymentId) {
      // Drop existing constraints and indexes on external_payment_id
      await queryRunner.query(
        `ALTER TABLE "payment_history" DROP CONSTRAINT IF EXISTS "UQ_payment_history_external_payment_id"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_payment_history_external_payment_id"`,
      );

      // Rename column from external_payment_id to payment_gateway_transaction_id
      await queryRunner.query(
        `ALTER TABLE "payment_history" RENAME COLUMN "external_payment_id" TO "payment_gateway_transaction_id"`,
      );

      // Re-create constraints and indexes with new column name
      await queryRunner.query(
        `ALTER TABLE "payment_history" ADD CONSTRAINT "UQ_payment_history_payment_gateway_transaction_id" UNIQUE ("payment_gateway_transaction_id")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_payment_history_payment_gateway_transaction_id" ON "payment_history" ("payment_gateway_transaction_id")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Check if the column exists before reverting
    const hasPaymentGatewayTransactionId = await queryRunner.hasColumn(
      'payment_history',
      'payment_gateway_transaction_id',
    );

    if (hasPaymentGatewayTransactionId) {
      // Drop constraints and indexes on payment_gateway_transaction_id
      await queryRunner.query(
        `ALTER TABLE "payment_history" DROP CONSTRAINT IF EXISTS "UQ_payment_history_payment_gateway_transaction_id"`,
      );
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_payment_history_payment_gateway_transaction_id"`,
      );

      // Revert column name back to external_payment_id
      await queryRunner.query(
        `ALTER TABLE "payment_history" RENAME COLUMN "payment_gateway_transaction_id" TO "external_payment_id"`,
      );

      // Re-create original constraints and indexes
      await queryRunner.query(
        `ALTER TABLE "payment_history" ADD CONSTRAINT "UQ_payment_history_external_payment_id" UNIQUE ("external_payment_id")`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_payment_history_external_payment_id" ON "payment_history" ("external_payment_id")`,
      );
    }
  }
}
