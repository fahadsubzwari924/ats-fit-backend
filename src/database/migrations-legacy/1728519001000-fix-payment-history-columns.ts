import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixPaymentHistoryColumns1728519001000
  implements MigrationInterface
{
  name = 'FixPaymentHistoryColumns1728519001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if the old columns exist before renaming
    const hasLemonSqueezyId = await queryRunner.hasColumn(
      'payment_history',
      'lemon_squeezy_id',
    );
    const hasLemonSqueezyPayload = await queryRunner.hasColumn(
      'payment_history',
      'lemon_squeezy_payload',
    );

    if (hasLemonSqueezyId) {
      // Rename lemon_squeezy_id to external_payment_id
      await queryRunner.query(
        `ALTER TABLE "payment_history" RENAME COLUMN "lemon_squeezy_id" TO "external_payment_id"`,
      );

      // Update the index
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_334a2d6c667ce10393a1cb6e9c"`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_payment_history_external_payment_id" ON "payment_history" ("external_payment_id")`,
      );
    }

    if (hasLemonSqueezyPayload) {
      // Rename lemon_squeezy_payload to payment_gateway_response
      await queryRunner.query(
        `ALTER TABLE "payment_history" RENAME COLUMN "lemon_squeezy_payload" TO "payment_gateway_response"`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Check if the new columns exist before reverting
    const hasExternalPaymentId = await queryRunner.hasColumn(
      'payment_history',
      'external_payment_id',
    );
    const hasPaymentGatewayResponse = await queryRunner.hasColumn(
      'payment_history',
      'payment_gateway_response',
    );

    if (hasPaymentGatewayResponse) {
      // Revert payment_gateway_response to lemon_squeezy_payload
      await queryRunner.query(
        `ALTER TABLE "payment_history" RENAME COLUMN "payment_gateway_response" TO "lemon_squeezy_payload"`,
      );
    }

    if (hasExternalPaymentId) {
      // Update the index back
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_payment_history_external_payment_id"`,
      );
      await queryRunner.query(
        `CREATE INDEX "IDX_334a2d6c667ce10393a1cb6e9c" ON "payment_history" ("lemon_squeezy_id")`,
      );

      // Revert external_payment_id to lemon_squeezy_id
      await queryRunner.query(
        `ALTER TABLE "payment_history" RENAME COLUMN "external_payment_id" TO "lemon_squeezy_id"`,
      );
    }
  }
}
