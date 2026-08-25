import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Task 10 of the LemonSqueezy -> Creem migration.
 *
 * Four schema changes, one atomic transaction (TypeORM's default
 * `migrationsTransactionMode: "all"` is left untouched -- see data-source.ts):
 *
 *  1. subscription_plans.payment_gateway_variant_id -> payment_gateway_product_id
 *     (Creem has products, not variants -- rename only, values untouched).
 *  2. user_subscriptions gains payment_gateway_customer_id + an index, so
 *     customer-portal links can be generated without parsing a jsonb blob.
 *  3. user_subscriptions_status_enum gains 'scheduled_cancel'.
 *  4. payment_history gets an exact single-column
 *     UNIQUE (payment_gateway_transaction_id) constraint -- the atomic
 *     replay-dedup gate Task 7 keys `INSERT ... ON CONFLICT
 *     (payment_gateway_transaction_id) DO NOTHING` off of.
 *
 * --- Why change 4 is not a plain `ADD CONSTRAINT` --------------------------
 *
 * This repo's `payment_history` table predates the InitialSchema squash
 * (1777938340136). A database provisioned by replaying the full incremental
 * migration history (every environment that existed before the squash --
 * verified true of the local dev Postgres this migration was tested against,
 * and very likely true of Railway production, which shares that lineage)
 * already carries a single-column UNIQUE constraint on
 * payment_gateway_transaction_id -- just under a stale name
 * ("UQ_payment_history_lemon_squeezy_id") inherited from before the column
 * itself was renamed twice (lemon_squeezy_id -> external_payment_id ->
 * payment_gateway_transaction_id). Postgres does not rename a constraint
 * when its column is renamed. That same lineage also left behind a
 * redundant plain (non-unique) index on the same column
 * ("IDX_payment_history_lemon_squeezy_id") -- dead weight, and exactly the
 * kind of duplication the binding security requirements forbid introducing.
 *
 * A database created fresh from InitialSchema.ts as literally written has
 * neither object -- InitialSchema's payment_history CREATE TABLE defines no
 * unique constraint on this column at all.
 *
 * Blindly running `ADD CONSTRAINT "UQ_payment_history_gateway_transaction_id"
 * UNIQUE (...)` is safe on a fresh DB but on the legacy-lineage DB it
 * silently succeeds while creating a *second*, fully redundant UNIQUE
 * constraint (Postgres does not reject duplicate unique constraints on the
 * same column) -- functionally harmless for `ON CONFLICT` inference, but a
 * direct violation of "no duplication" and something nobody asked for.
 *
 * So the constraint step below is idempotent and lineage-agnostic:
 *   - canonical name already present            -> no-op (safe re-run)
 *   - a differently-named single-column UNIQUE
 *     constraint on this column already exists  -> RENAME CONSTRAINT
 *     (metadata-only, instant, no table rewrite, no reindex, uninterrupted
 *     enforcement)
 *   - neither exists                            -> ADD CONSTRAINT
 * followed by dropping any pre-existing plain duplicate index on exactly
 * this column, however it was named.
 *
 * End state, verified byte-for-byte with pg_get_constraintdef: exactly one
 * constraint, `UNIQUE (payment_gateway_transaction_id)`, single column, no
 * partial/expression/multi-column variant, no separate index -- an exact
 * match for what `ON CONFLICT (payment_gateway_transaction_id)` inference
 * requires, regardless of which lineage the target database came from.
 *
 * down() intentionally does not attempt to resurrect whatever legacy name
 * or duplicate index it may have started from -- it drops the canonical
 * constraint and leaves it at that. Reverting on a legacy-lineage DB
 * therefore ends with no unique constraint on this column at all, which
 * differs from that DB's original pre-migration state (constraint present,
 * badly named) but matches the InitialSchema-fresh baseline. This is a
 * deliberate simplification, not an oversight: resurrecting stale naming
 * debt is not a requirement this migration owns.
 */
export class RenameVariantToProductAndAddCustomerId1815300000000 implements MigrationInterface {
  name = 'RenameVariantToProductAndAddCustomerId1815300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // 1. subscription_plans: variant -> product (rename only)
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "subscription_plans" RENAME COLUMN "payment_gateway_variant_id" TO "payment_gateway_product_id"`,
    );

    // ------------------------------------------------------------------
    // 2. user_subscriptions: new customer-id column + its own index
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ADD COLUMN "payment_gateway_customer_id" character varying`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_subscriptions_payment_gateway_customer_id" ON "user_subscriptions" ("payment_gateway_customer_id")`,
    );

    // ------------------------------------------------------------------
    // 3. payment_history: duplicate pre-flight, then the unique constraint
    // ------------------------------------------------------------------

    // Abort on duplicates -- never auto-deduplicate. Picking which payment
    // row to delete without human review is itself a data-integrity
    // incident. Must run before ADD CONSTRAINT, inside up(), so an
    // unattended `preDeployCommand` run on Railway fails loudly instead of
    // shipping code against a half-migrated schema.
    await queryRunner.query(`
      DO $$
      DECLARE dup_count int;
      BEGIN
        SELECT COUNT(*) INTO dup_count FROM (
          SELECT payment_gateway_transaction_id FROM payment_history
          GROUP BY payment_gateway_transaction_id HAVING COUNT(*) > 1
        ) d;
        IF dup_count > 0 THEN
          RAISE EXCEPTION 'Aborting migration: % duplicate payment_gateway_transaction_id value(s) in payment_history', dup_count;
        END IF;
      END $$;
    `);

    // Normalize to exactly one canonically-named, single-column UNIQUE
    // constraint on payment_gateway_transaction_id -- see the class-level
    // comment for why this can't be a plain, unconditional ADD CONSTRAINT.
    await queryRunner.query(`
      DO $$
      DECLARE
        existing_unique_conname text;
        target_attnum smallint;
        canonical_exists boolean;
      BEGIN
        SELECT attnum INTO target_attnum
        FROM pg_attribute
        WHERE attrelid = 'payment_history'::regclass
          AND attname = 'payment_gateway_transaction_id';

        SELECT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'payment_history'::regclass
            AND conname = 'UQ_payment_history_gateway_transaction_id'
        ) INTO canonical_exists;

        IF canonical_exists THEN
          -- Already in the desired end state (idempotent re-run) -- no-op.
          NULL;
        ELSE
          SELECT c.conname INTO existing_unique_conname
          FROM pg_constraint c
          WHERE c.conrelid = 'payment_history'::regclass
            AND c.contype = 'u'
            AND c.conkey = ARRAY[target_attnum]
            AND NOT c.condeferrable
          LIMIT 1;

          IF existing_unique_conname IS NOT NULL THEN
            EXECUTE format(
              'ALTER TABLE "payment_history" RENAME CONSTRAINT %I TO "UQ_payment_history_gateway_transaction_id"',
              existing_unique_conname
            );
          ELSE
            ALTER TABLE "payment_history"
              ADD CONSTRAINT "UQ_payment_history_gateway_transaction_id"
              UNIQUE ("payment_gateway_transaction_id");
          END IF;
        END IF;
      END $$;
    `);

    // Drop any pre-existing plain (non-unique) duplicate index covering
    // only this column -- redundant now that the UNIQUE constraint above
    // supplies its own backing index. No separate CREATE INDEX is ever
    // added by this migration; this only removes duplication left behind
    // by pre-squash migration history.
    await queryRunner.query(`
      DO $$
      DECLARE
        dup_index_name text;
        target_attnum smallint;
      BEGIN
        SELECT attnum INTO target_attnum
        FROM pg_attribute
        WHERE attrelid = 'payment_history'::regclass
          AND attname = 'payment_gateway_transaction_id';

        FOR dup_index_name IN
          SELECT i.relname
          FROM pg_index ix
          JOIN pg_class i ON i.oid = ix.indexrelid
          WHERE ix.indrelid = 'payment_history'::regclass
            AND ix.indisunique = false
            AND ix.indisprimary = false
            AND ix.indpred IS NULL -- never drop a PARTIAL index; it may be load-bearing
            AND array_length(ix.indkey::int[], 1) = 1
            AND ix.indkey[0] = target_attnum
        LOOP
          EXECUTE format('DROP INDEX IF EXISTS %I', dup_index_name);
        END LOOP;
      END $$;
    `);

    // ------------------------------------------------------------------
    // 4. user_subscriptions_status_enum: add 'scheduled_cancel'
    // ------------------------------------------------------------------
    // Rename/recreate/cast swap, not ALTER TYPE ... ADD VALUE. PG 16 allows
    // ADD VALUE inside a transaction, so that is not the reason -- the
    // reason is ADD VALUE has no inverse, which would make down()
    // impossible. New label list is byte-identical to the old five plus
    // 'scheduled_cancel'.
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "user_subscriptions_status_enum" RENAME TO "user_subscriptions_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "user_subscriptions_status_enum" AS ENUM('active', 'cancelled', 'expired', 'paused', 'past_due', 'scheduled_cancel')`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ALTER COLUMN "status" TYPE "user_subscriptions_status_enum" USING "status"::text::"user_subscriptions_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ALTER COLUMN "status" SET DEFAULT 'active'`,
    );
    await queryRunner.query(`DROP TYPE "user_subscriptions_status_enum_old"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ------------------------------------------------------------------
    // 4 (reverse). Refuse to revert the enum if any row is entitled under
    // the value being removed. Never auto-remap: coercing to 'cancelled'
    // revokes access from someone entitled to it; coercing to 'active'
    // hides a pending cancellation. Both are access-control decisions
    // nobody made -- refuse and force a human call.
    // ------------------------------------------------------------------
    await queryRunner.query(`
      DO $$
      DECLARE dup_count int;
      BEGIN
        SELECT COUNT(*) INTO dup_count FROM user_subscriptions WHERE status = 'scheduled_cancel';
        IF dup_count > 0 THEN
          RAISE EXCEPTION 'Aborting revert: % row(s) in user_subscriptions have status = ''scheduled_cancel''. Resolve each row''s entitlement by hand (remap to cancelled or active is an access-control decision this migration will not make) before reverting.', dup_count;
        END IF;
      END $$;
    `);

    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "user_subscriptions_status_enum" RENAME TO "user_subscriptions_status_enum_new"`,
    );
    await queryRunner.query(
      `CREATE TYPE "user_subscriptions_status_enum" AS ENUM('active', 'cancelled', 'expired', 'paused', 'past_due')`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ALTER COLUMN "status" TYPE "user_subscriptions_status_enum" USING "status"::text::"user_subscriptions_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ALTER COLUMN "status" SET DEFAULT 'active'`,
    );
    await queryRunner.query(`DROP TYPE "user_subscriptions_status_enum_new"`);

    // ------------------------------------------------------------------
    // 3 (reverse). Drop the canonical constraint. See class-level comment:
    // this deliberately does not resurrect a pre-existing legacy name or
    // the duplicate index that may have preceded it.
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "payment_history" DROP CONSTRAINT IF EXISTS "UQ_payment_history_gateway_transaction_id"`,
    );

    // ------------------------------------------------------------------
    // 2 (reverse).
    // ------------------------------------------------------------------
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_subscriptions_payment_gateway_customer_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" DROP COLUMN "payment_gateway_customer_id"`,
    );

    // ------------------------------------------------------------------
    // 1 (reverse).
    // ------------------------------------------------------------------
    await queryRunner.query(
      `ALTER TABLE "subscription_plans" RENAME COLUMN "payment_gateway_product_id" TO "payment_gateway_variant_id"`,
    );
  }
}
