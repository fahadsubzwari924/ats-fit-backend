import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GDPR readiness follow-up to Task 9 of the LemonSqueezy -> Creem migration.
 *
 * Adds `payment_history.anonymized_at timestamp NULL`, a marker column for a
 * row whose personal fields have been stripped in response to an erasure
 * request. Nothing writes to it yet — the `UserErasureService` that will is a
 * separate, later piece of work. This migration only prepares the schema;
 * see the doc comment on `PaymentHistory.anonymized_at` in
 * `payment-history.entity.ts` for the same note kept next to the property so
 * it doesn't read as dead code.
 *
 * Deliberately its own migration, not folded into
 * `1815400000000-AddProcessingClaimedAtToPaymentHistory` (already
 * reviewed/verified against a live four-path race test) or
 * `1815300000000-RenameVariantToProductAndAddCustomerId` (already reviewed)
 * — same one-column-add pattern and reasoning as 1815400000000.
 *
 * `nullable: true` (no default): `NULL` is the natural "not anonymized"
 * starting state for every pre-existing row and every row inserted before
 * this column has a writer.
 */
export class AddAnonymizedAtToPaymentHistory1815500000000 implements MigrationInterface {
  name = 'AddAnonymizedAtToPaymentHistory1815500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_history" ADD COLUMN "anonymized_at" TIMESTAMP NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_history" DROP COLUMN "anonymized_at"`,
    );
  }
}
