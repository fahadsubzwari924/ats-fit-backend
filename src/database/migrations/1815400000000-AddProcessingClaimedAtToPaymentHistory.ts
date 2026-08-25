import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task 9 of the LemonSqueezy -> Creem migration.
 *
 * A separate migration from Task 10's RenameVariantToProductAndAddCustomerId
 * (1815300000000) -- that migration is already reviewed and verified, so this
 * one only adds the single column the atomic replay-claim gate needs.
 *
 * `payment_history.processing_claimed_at` backs the claim UPSERT that
 * replaced the original "INSERT ... ON CONFLICT DO NOTHING" dedup design
 * (see "Decisions adopted after the Task 7 architecture consult" /
 * SUPERSEDED block in the migration plan). That original design was proven
 * live to leave a race window equal to the handler's own execution time: once
 * the first delivery's row is committed, a second concurrent delivery's
 * `DO NOTHING` insert returns zero rows immediately and still reads
 * `processed_at IS NULL`, so both deliveries run the handler.
 *
 * The replacement makes the reservation itself conditional:
 *
 *   INSERT ... ON CONFLICT (payment_gateway_transaction_id)
 *   DO UPDATE SET processing_claimed_at = now()
 *   WHERE payment_history.processed_at IS NULL
 *     AND (payment_history.processing_claimed_at IS NULL
 *          OR payment_history.processing_claimed_at < now() - interval '2 minutes')
 *   RETURNING id
 *
 * `rows > 0` -> caller owns this event, safe to run the handler.
 * `rows = 0` -> already processed, or claimed by an in-flight attempt within
 * the last two minutes -> skip.
 *
 * The two-minute staleness window exists so a crashed/hung handler's claim
 * expires and Creem's own retry (30s/1m/5m/1h cadence) can legitimately
 * reprocess the event, rather than the row being stuck unprocessable forever.
 * No held transactions, no row/advisory locks -- this repo runs ~10 pooled
 * connections and holding one for the handler's full duration (which
 * includes an outbound AWS SES call) is not acceptable.
 *
 * `nullable: true` (no default): NULL means "never claimed / claim not
 * currently held" -- the natural starting state for both freshly-inserted
 * rows created outside this gate and any pre-existing row from before this
 * migration ran.
 */
export class AddProcessingClaimedAtToPaymentHistory1815400000000 implements MigrationInterface {
  name = 'AddProcessingClaimedAtToPaymentHistory1815400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_history" ADD COLUMN "processing_claimed_at" TIMESTAMP NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_history" DROP COLUMN "processing_claimed_at"`,
    );
  }
}
