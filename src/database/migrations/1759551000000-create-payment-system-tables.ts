import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePaymentSystemTables1759551000000 implements MigrationInterface {
    name = 'CreatePaymentSystemTables1759551000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create subscription_plans table
        await queryRunner.query(`CREATE TABLE "subscription_plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan_name" character varying NOT NULL, "description" text NOT NULL, "price" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "lemon_squeezy_variant_id" character varying NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "features" jsonb, "billing_cycle" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_subscription_plans_lemon_squeezy_variant_id" UNIQUE ("lemon_squeezy_variant_id"), CONSTRAINT "PK_subscription_plans" PRIMARY KEY ("id"))`);
        
        // Create subscription status enum
        await queryRunner.query(`CREATE TYPE "public"."subscriptions_status_enum" AS ENUM('active', 'cancelled', 'expired', 'paused', 'past_due')`);
        
        // Create subscriptions table
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lemon_squeezy_id" character varying NOT NULL, "status" "public"."subscriptions_status_enum" NOT NULL DEFAULT 'active', "amount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "starts_at" TIMESTAMP NOT NULL, "trial_ends_at" TIMESTAMP, "ends_at" TIMESTAMP NOT NULL, "is_active" boolean NOT NULL DEFAULT false, "is_cancelled" boolean NOT NULL DEFAULT false, "user_id" uuid NOT NULL, "subscription_plan_id" uuid NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_subscriptions_lemon_squeezy_id" UNIQUE ("lemon_squeezy_id"), CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id"))`);
        
        // Create payment enums
        await queryRunner.query(`CREATE TYPE "public"."payment_history_status_enum" AS ENUM('pending', 'success', 'failed', 'cancelled', 'refunded', 'expired')`);
        await queryRunner.query(`CREATE TYPE "public"."payment_history_payment_type_enum" AS ENUM('subscription', 'one_time', 'refund')`);
        
        // Create payment_history table
        await queryRunner.query(`CREATE TABLE "payment_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lemon_squeezy_id" character varying NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "status" "public"."payment_history_status_enum" NOT NULL DEFAULT 'pending', "payment_type" "public"."payment_history_payment_type_enum" NOT NULL, "user_id" uuid NOT NULL, "subscription_plan_id" uuid, "lemon_squeezy_payload" jsonb NOT NULL, "customer_email" character varying, "is_test_mode" boolean NOT NULL DEFAULT false, "processed_at" TIMESTAMP, "retry_count" integer NOT NULL DEFAULT 0, "last_retry_at" TIMESTAMP, "processing_error" text, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_payment_history_lemon_squeezy_id" UNIQUE ("lemon_squeezy_id"), CONSTRAINT "PK_payment_history" PRIMARY KEY ("id"))`);
        
        // Create indexes
        await queryRunner.query(`CREATE INDEX "IDX_subscription_plans_lemon_squeezy_variant_id" ON "subscription_plans" ("lemon_squeezy_variant_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_subscriptions_lemon_squeezy_id" ON "subscriptions" ("lemon_squeezy_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_subscriptions_user_id_status" ON "subscriptions" ("user_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_payment_history_lemon_squeezy_id" ON "payment_history" ("lemon_squeezy_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_payment_history_user_id_status" ON "payment_history" ("user_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_payment_history_subscription_plan_id_created_at" ON "payment_history" ("subscription_plan_id", "created_at") `);
        
        // Add foreign key constraints
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_subscriptions_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "subscriptions" ADD CONSTRAINT "FK_subscriptions_subscription_plan_id" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_history" ADD CONSTRAINT "FK_payment_history_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "payment_history" ADD CONSTRAINT "FK_payment_history_subscription_plan_id" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove foreign key constraints
        await queryRunner.query(`ALTER TABLE "payment_history" DROP CONSTRAINT "FK_payment_history_subscription_plan_id"`);
        await queryRunner.query(`ALTER TABLE "payment_history" DROP CONSTRAINT "FK_payment_history_user_id"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_subscriptions_subscription_plan_id"`);
        await queryRunner.query(`ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_subscriptions_user_id"`);
        
        // Drop indexes
        await queryRunner.query(`DROP INDEX "public"."IDX_payment_history_subscription_plan_id_created_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_payment_history_user_id_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_payment_history_lemon_squeezy_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_subscriptions_user_id_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_subscriptions_lemon_squeezy_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_subscription_plans_lemon_squeezy_variant_id"`);
        
        // Drop tables
        await queryRunner.query(`DROP TABLE "payment_history"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
        await queryRunner.query(`DROP TABLE "subscription_plans"`);
        
        // Drop enums
        await queryRunner.query(`DROP TYPE "public"."payment_history_payment_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."payment_history_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."subscriptions_status_enum"`);
    }
}