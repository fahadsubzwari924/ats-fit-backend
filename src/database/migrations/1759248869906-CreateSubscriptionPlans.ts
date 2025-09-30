import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSubscriptionPlans1759248869906 implements MigrationInterface {
    name = 'CreateSubscriptionPlans1759248869906'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "subscriptions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lemonSqueezyId" character varying NOT NULL, "planId" character varying NOT NULL, "status" character varying NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying NOT NULL, "startsAt" TIMESTAMP NOT NULL, "trialEndsAt" TIMESTAMP, "endsAt" TIMESTAMP NOT NULL, "isActive" boolean NOT NULL DEFAULT false, "isCancelled" boolean NOT NULL DEFAULT false, "metadata" jsonb, "userId" character varying NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "subscription_plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "planName" character varying NOT NULL, "description" text NOT NULL, "price" numeric(10,2) NOT NULL, "currency" character varying NOT NULL, "lemonSqueezyVariantId" character varying NOT NULL, "isActive" boolean NOT NULL DEFAULT true, "features" jsonb, "billingCycle" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9ab8fe6918451ab3d0a4fb6bb0c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "payment_history" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "lemonSqueezyId" character varying NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying NOT NULL, "status" character varying NOT NULL, "paymentType" character varying NOT NULL, "userId" uuid NOT NULL, "metadata" jsonb, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5fcec51a769b65c0c3c0987f11c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "payment_history" ADD CONSTRAINT "FK_34d643de1a588d2350297da5c24" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payment_history" DROP CONSTRAINT "FK_34d643de1a588d2350297da5c24"`);
        await queryRunner.query(`DROP TABLE "payment_history"`);
        await queryRunner.query(`DROP TABLE "subscription_plans"`);
        await queryRunner.query(`DROP TABLE "subscriptions"`);
    }

}
