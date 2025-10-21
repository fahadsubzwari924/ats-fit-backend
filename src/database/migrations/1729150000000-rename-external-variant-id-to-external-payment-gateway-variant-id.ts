import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameExternalVariantIdToExternalPaymentGatewayVariantId1729150000000 implements MigrationInterface {
    name = 'RenameExternalVariantIdToExternalPaymentGatewayVariantId1729150000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Check if the old column exists before renaming
        const hasOldColumn = await queryRunner.hasColumn('subscription_plans', 'external_variant_id');
        
        if (hasOldColumn) {
            // Rename the column from external_variant_id to external_payment_gateway_variant_id
            await queryRunner.query(`ALTER TABLE "subscription_plans" RENAME COLUMN "external_variant_id" TO "external_payment_gateway_variant_id"`);
            
            // Update the unique index
            await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscription_plans_external_variant_id"`);
            await queryRunner.query(`CREATE UNIQUE INDEX "IDX_subscription_plans_external_payment_gateway_variant_id" ON "subscription_plans" ("external_payment_gateway_variant_id")`);
            
            // Update unique constraints if they exist
            await queryRunner.query(`ALTER TABLE "subscription_plans" DROP CONSTRAINT IF EXISTS "UQ_subscription_plans_external_variant_id"`);
            await queryRunner.query(`ALTER TABLE "subscription_plans" ADD CONSTRAINT "UQ_subscription_plans_external_payment_gateway_variant_id" UNIQUE ("external_payment_gateway_variant_id")`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Check if the new column exists before reverting
        const hasNewColumn = await queryRunner.hasColumn('subscription_plans', 'external_payment_gateway_variant_id');
        
        if (hasNewColumn) {
            // Revert unique constraints
            await queryRunner.query(`ALTER TABLE "subscription_plans" DROP CONSTRAINT IF EXISTS "UQ_subscription_plans_external_payment_gateway_variant_id"`);
            await queryRunner.query(`ALTER TABLE "subscription_plans" ADD CONSTRAINT "UQ_subscription_plans_external_variant_id" UNIQUE ("external_variant_id")`);
            
            // Revert the index
            await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscription_plans_external_payment_gateway_variant_id"`);
            await queryRunner.query(`CREATE UNIQUE INDEX "IDX_subscription_plans_external_variant_id" ON "subscription_plans" ("external_variant_id")`);
            
            // Revert the column name
            await queryRunner.query(`ALTER TABLE "subscription_plans" RENAME COLUMN "external_payment_gateway_variant_id" TO "external_variant_id"`);
        }
    }
}