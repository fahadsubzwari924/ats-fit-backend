import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes guest users: drops guest_id columns, narrows user_type enums to `registered` only,
 * and deletes rate_limit_configs rows for guest user_type.
 */
export class RemoveGuestUserType20260406140000 implements MigrationInterface {
  name = 'RemoveGuestUserType20260406140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "rate_limit_configs" WHERE "user_type"::text = 'guest'`,
    );

    await queryRunner.query(
      `UPDATE "users" SET "user_type" = 'registered' WHERE "user_type"::text = 'guest'`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_users_guest_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_58394bc638089670195fcc9bf5"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_resume_generation_results_guest_id"`,
    );

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "guest_id"`);
    await queryRunner.query(
      `ALTER TABLE "usage_tracking" DROP COLUMN IF EXISTS "guest_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "guest_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" DROP COLUMN IF EXISTS "guest_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ats_match_histories" DROP COLUMN IF EXISTS "guest_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generation_results" DROP COLUMN IF EXISTS "guest_id"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "user_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."users_user_type_enum_new" AS ENUM('registered')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "user_type" TYPE "public"."users_user_type_enum_new" USING ("user_type"::text)::"public"."users_user_type_enum_new"`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_user_type_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."users_user_type_enum_new" RENAME TO "users_user_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "user_type" SET DEFAULT 'registered'::"public"."users_user_type_enum"`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."rate_limit_configs_user_type_enum_new" AS ENUM('registered')`,
    );
    await queryRunner.query(
      `ALTER TABLE "rate_limit_configs" ALTER COLUMN "user_type" TYPE "public"."rate_limit_configs_user_type_enum_new" USING ("user_type"::text)::"public"."rate_limit_configs_user_type_enum_new"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."rate_limit_configs_user_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."rate_limit_configs_user_type_enum_new" RENAME TO "rate_limit_configs_user_type_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."users_user_type_enum_old" AS ENUM('guest', 'registered')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "user_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "user_type" TYPE "public"."users_user_type_enum_old" USING 'registered'::text::"public"."users_user_type_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_user_type_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."users_user_type_enum_old" RENAME TO "users_user_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "user_type" SET DEFAULT 'registered'::"public"."users_user_type_enum"`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."rate_limit_configs_user_type_enum_old" AS ENUM('guest', 'registered')`,
    );
    await queryRunner.query(
      `ALTER TABLE "rate_limit_configs" ALTER COLUMN "user_type" TYPE "public"."rate_limit_configs_user_type_enum_old" USING 'registered'::text::"public"."rate_limit_configs_user_type_enum_old"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."rate_limit_configs_user_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."rate_limit_configs_user_type_enum_old" RENAME TO "rate_limit_configs_user_type_enum"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "guest_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "usage_tracking" ADD COLUMN "guest_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN "guest_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "job_applications" ADD COLUMN "guest_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "ats_match_histories" ADD COLUMN "guest_id" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "resume_generation_results" ADD COLUMN "guest_id" character varying`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_58394bc638089670195fcc9bf5" ON "usage_tracking" ("guest_id", "feature_type", "month", "year")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_resume_generation_results_guest_id" ON "resume_generation_results" ("guest_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_users_guest_id" ON "users" ("guest_id")`,
    );
  }
}
