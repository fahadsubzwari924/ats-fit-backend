import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds beta access support:
 * - Creates `beta_invites` table with all required columns, constraints, and indexes
 * - Adds `is_beta_user`, `beta_access_until`, `founding_rate_locked` columns to `users`
 * - Creates index on `users.beta_access_until` for expiry sweep cron efficiency
 */
export class AddBetaAccess1763100000000 implements MigrationInterface {
  name = 'AddBetaAccess1763100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "beta_invites" (
        "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        "email" varchar(255) UNIQUE NOT NULL,
        "code" varchar(16) UNIQUE NOT NULL,
        "code_expires_at" TIMESTAMPTZ NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'redeemed', 'expired', 'revoked')),
        "cohort" varchar(50) NOT NULL DEFAULT 'wave-1',
        "access_days" SMALLINT NOT NULL DEFAULT 30,
        "redeemed_at" TIMESTAMPTZ NULL,
        "redeemed_by_user_id" UUID NULL REFERENCES "users"("id") ON DELETE SET NULL,
        "pro_access_until" TIMESTAMPTZ NULL,
        "revoked_at" TIMESTAMPTZ NULL,
        "revoked_reason" varchar(200) NULL,
        "created_at" TIMESTAMPTZ DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_beta_invites_status_expires" ON "beta_invites" ("status", "code_expires_at")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_beta_invites_redeemed_by" ON "beta_invites" ("redeemed_by_user_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "is_beta_user" BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "beta_access_until" TIMESTAMPTZ NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "founding_rate_locked" BOOLEAN NOT NULL DEFAULT FALSE`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_users_beta_access_until" ON "users" ("beta_access_until")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_users_beta_access_until"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "founding_rate_locked"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "beta_access_until"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_beta_user"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_beta_invites_redeemed_by"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_beta_invites_status_expires"`,
    );

    await queryRunner.query(`DROP TABLE IF EXISTS "beta_invites"`);
  }
}
