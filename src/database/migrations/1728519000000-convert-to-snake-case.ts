import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConvertToSnakeCase1728519000000 implements MigrationInterface {
    name = 'ConvertToSnakeCase1728519000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // This migration converts all entity properties to snake_case for database consistency
        
        // === PAYMENT_HISTORY table updates ===
        // Rename lemon_squeezy_id to external_payment_id (more generic)
        await queryRunner.query(`ALTER TABLE "payment_history" RENAME COLUMN "lemon_squeezy_id" TO "external_payment_id"`);
        
        // Rename lemon_squeezy_payload to payment_gateway_response (stores payment gateway response)
        await queryRunner.query(`ALTER TABLE "payment_history" RENAME COLUMN "lemon_squeezy_payload" TO "payment_gateway_response"`);
        
        // Update indexes for payment_history
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_history_lemon_squeezy_id"`);
        await queryRunner.query(`CREATE INDEX "IDX_payment_history_external_payment_id" ON "payment_history" ("external_payment_id")`);
        
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_history_userId_status"`);
        await queryRunner.query(`CREATE INDEX "IDX_payment_history_user_id_status" ON "payment_history" ("user_id", "status")`);
        
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_history_subscriptionPlanId_createdAt"`);
        await queryRunner.query(`CREATE INDEX "IDX_payment_history_subscription_plan_id_created_at" ON "payment_history" ("subscription_plan_id", "created_at")`);
        
        // === USER_SUBSCRIPTIONS table updates ===
        // Update indexes for user_subscriptions
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_subscriptions_externalSubscriptionId"`);
        await queryRunner.query(`CREATE INDEX "IDX_user_subscriptions_external_subscription_id" ON "user_subscriptions" ("external_subscription_id")`);
        
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_subscriptions_userId_status"`);
        await queryRunner.query(`CREATE INDEX "IDX_user_subscriptions_user_id_status" ON "user_subscriptions" ("user_id", "status")`);
        
        // === SUBSCRIPTION_PLANS table updates ===
        // Update indexes for subscription_plans
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscription_plans_externalVariantId"`);
        await queryRunner.query(`CREATE INDEX "IDX_subscription_plans_external_variant_id" ON "subscription_plans" ("external_variant_id")`);
        
        // Update unique constraints if they exist
        await queryRunner.query(`ALTER TABLE "payment_history" DROP CONSTRAINT IF EXISTS "UQ_payment_history_lemon_squeezy_id"`);
        await queryRunner.query(`ALTER TABLE "payment_history" ADD CONSTRAINT "UQ_payment_history_external_payment_id" UNIQUE ("external_payment_id")`);
        
        await queryRunner.query(`ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "UQ_user_subscriptions_external_subscription_id"`);
        await queryRunner.query(`ALTER TABLE "user_subscriptions" ADD CONSTRAINT "UQ_user_subscriptions_external_subscription_id" UNIQUE ("external_subscription_id")`);
        
        await queryRunner.query(`ALTER TABLE "subscription_plans" DROP CONSTRAINT IF EXISTS "UQ_subscription_plans_external_variant_id"`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" ADD CONSTRAINT "UQ_subscription_plans_external_variant_id" UNIQUE ("external_variant_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert all changes - this is a complex migration so we provide full rollback
        
        // Revert unique constraints
        await queryRunner.query(`ALTER TABLE "subscription_plans" DROP CONSTRAINT IF EXISTS "UQ_subscription_plans_external_variant_id"`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" ADD CONSTRAINT "UQ_subscription_plans_lemon_squeezy_variant_id" UNIQUE ("lemon_squeezy_variant_id")`);
        
        await queryRunner.query(`ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "UQ_user_subscriptions_external_subscription_id"`);
        await queryRunner.query(`ALTER TABLE "user_subscriptions" ADD CONSTRAINT "UQ_user_subscriptions_lemon_squeezy_id" UNIQUE ("lemon_squeezy_id")`);
        
        await queryRunner.query(`ALTER TABLE "payment_history" DROP CONSTRAINT IF EXISTS "UQ_payment_history_external_payment_id"`);
        await queryRunner.query(`ALTER TABLE "payment_history" ADD CONSTRAINT "UQ_payment_history_lemon_squeezy_id" UNIQUE ("lemon_squeezy_id")`);
        
        // Revert indexes for subscription_plans
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscription_plans_external_variant_id"`);
        await queryRunner.query(`CREATE INDEX "IDX_subscription_plans_externalVariantId" ON "subscription_plans" ("external_variant_id")`);
        
        // Revert indexes for user_subscriptions  
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_subscriptions_user_id_status"`);
        await queryRunner.query(`CREATE INDEX "IDX_user_subscriptions_userId_status" ON "user_subscriptions" ("user_id", "status")`);
        
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_subscriptions_external_subscription_id"`);
        await queryRunner.query(`CREATE INDEX "IDX_user_subscriptions_externalSubscriptionId" ON "user_subscriptions" ("external_subscription_id")`);
        
        // Revert indexes for payment_history
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_history_subscription_plan_id_created_at"`);
        await queryRunner.query(`CREATE INDEX "IDX_payment_history_subscriptionPlanId_createdAt" ON "payment_history" ("subscription_plan_id", "created_at")`);
        
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_history_user_id_status"`);
        await queryRunner.query(`CREATE INDEX "IDX_payment_history_userId_status" ON "payment_history" ("user_id", "status")`);
        
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payment_history_external_payment_id"`);
        await queryRunner.query(`CREATE INDEX "IDX_payment_history_lemon_squeezy_id" ON "payment_history" ("external_payment_id")`);
        
        // Revert column renames for payment_history
        await queryRunner.query(`ALTER TABLE "payment_history" RENAME COLUMN "payment_gateway_response" TO "lemon_squeezy_payload"`);
        await queryRunner.query(`ALTER TABLE "payment_history" RENAME COLUMN "external_payment_id" TO "lemon_squeezy_id"`);
    }
}