import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenamePaymentGatewayColumns1728518500000 implements MigrationInterface {
    name = 'RenamePaymentGatewayColumns1728518500000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Rename columns to be payment gateway agnostic
        
        // Rename subscription_plans.lemon_squeezy_variant_id to external_variant_id
        await queryRunner.query(`ALTER TABLE "subscription_plans" RENAME COLUMN "lemon_squeezy_variant_id" TO "external_variant_id"`);
        
        // Rename user_subscriptions.lemon_squeezy_id to external_subscription_id
        await queryRunner.query(`ALTER TABLE "user_subscriptions" RENAME COLUMN "lemon_squeezy_id" TO "external_subscription_id"`);
        
        // Update indexes to use new column names
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscription_plans_lemon_squeezy_variant_id"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_subscription_plans_external_variant_id" ON "subscription_plans" ("external_variant_id")`);
        
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_subscriptions_lemon_squeezy_id"`);
        await queryRunner.query(`CREATE INDEX "IDX_user_subscriptions_external_subscription_id" ON "user_subscriptions" ("external_subscription_id")`);
        
        // Update unique constraints if they exist
        await queryRunner.query(`ALTER TABLE "subscription_plans" DROP CONSTRAINT IF EXISTS "UQ_subscription_plans_lemon_squeezy_variant_id"`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" ADD CONSTRAINT "UQ_subscription_plans_external_variant_id" UNIQUE ("external_variant_id")`);
        
        await queryRunner.query(`ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "UQ_user_subscriptions_lemon_squeezy_id"`);
        await queryRunner.query(`ALTER TABLE "user_subscriptions" ADD CONSTRAINT "UQ_user_subscriptions_external_subscription_id" UNIQUE ("external_subscription_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert changes - rename back to original column names
        
        // Revert unique constraints
        await queryRunner.query(`ALTER TABLE "user_subscriptions" DROP CONSTRAINT IF EXISTS "UQ_user_subscriptions_external_subscription_id"`);
        await queryRunner.query(`ALTER TABLE "user_subscriptions" ADD CONSTRAINT "UQ_user_subscriptions_lemon_squeezy_id" UNIQUE ("lemon_squeezy_id")`);
        
        await queryRunner.query(`ALTER TABLE "subscription_plans" DROP CONSTRAINT IF EXISTS "UQ_subscription_plans_external_variant_id"`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" ADD CONSTRAINT "UQ_subscription_plans_lemon_squeezy_variant_id" UNIQUE ("lemon_squeezy_variant_id")`);
        
        // Revert indexes
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_subscriptions_external_subscription_id"`);
        await queryRunner.query(`CREATE INDEX "IDX_user_subscriptions_lemon_squeezy_id" ON "user_subscriptions" ("lemon_squeezy_id")`);
        
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscription_plans_external_variant_id"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_subscription_plans_lemon_squeezy_variant_id" ON "subscription_plans" ("lemon_squeezy_variant_id")`);
        
        // Rename columns back to original names
        await queryRunner.query(`ALTER TABLE "user_subscriptions" RENAME COLUMN "external_subscription_id" TO "lemon_squeezy_id"`);
        await queryRunner.query(`ALTER TABLE "subscription_plans" RENAME COLUMN "external_variant_id" TO "lemon_squeezy_variant_id"`);
    }
}