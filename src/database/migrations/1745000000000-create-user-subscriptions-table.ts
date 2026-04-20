import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserSubscriptionsTable1745000000000 implements MigrationInterface {
  name = 'CreateUserSubscriptionsTable1745000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enum type for user_subscriptions status (reuse existing if present)
    const enumExists = await queryRunner.query(
      `SELECT 1 FROM pg_type WHERE typname = 'user_subscriptions_status_enum'`,
    );
    if (!enumExists?.length) {
      await queryRunner.query(
        `CREATE TYPE "public"."user_subscriptions_status_enum" AS ENUM('active', 'cancelled', 'expired', 'paused', 'past_due')`,
      );
    }

    await queryRunner.query(`
      CREATE TABLE "user_subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "payment_gateway_subscription_id" character varying NOT NULL,
        "status" "public"."user_subscriptions_status_enum" NOT NULL DEFAULT 'active',
        "amount" numeric(10,2) NOT NULL DEFAULT 0,
        "currency" character varying(3) NOT NULL DEFAULT 'USD',
        "starts_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "ends_at" TIMESTAMP NOT NULL DEFAULT NOW(),
        "is_active" boolean NOT NULL DEFAULT false,
        "is_cancelled" boolean NOT NULL DEFAULT false,
        "cancelled_at" TIMESTAMP,
        "user_id" uuid NOT NULL,
        "subscription_plan_id" uuid NOT NULL,
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_subscriptions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_user_subscriptions_user_id_status" ON "user_subscriptions" ("user_id", "status")`,
    );

    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ADD CONSTRAINT "FK_user_subscriptions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ADD CONSTRAINT "FK_user_subscriptions_subscription_plan_id" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "FK_user_subscriptions_subscription_plan_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "FK_user_subscriptions_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_user_subscriptions_user_id_status"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_subscriptions"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."user_subscriptions_status_enum"`,
    );
  }
}
