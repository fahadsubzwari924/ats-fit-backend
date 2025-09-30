import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBillingTables1695747600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE subscriptions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lemon_squeezy_id VARCHAR NOT NULL,
        plan_id VARCHAR NOT NULL,
        status VARCHAR NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR NOT NULL,
        starts_at TIMESTAMP NOT NULL,
        trial_ends_at TIMESTAMP,
        ends_at TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT FALSE,
        is_cancelled BOOLEAN DEFAULT FALSE,
        metadata JSONB,
        user_id UUID REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE payment_history (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lemon_squeezy_id VARCHAR NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR NOT NULL,
        status VARCHAR NOT NULL,
        payment_type VARCHAR NOT NULL,
        user_id UUID REFERENCES users(id),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Indexes for better query performance
      CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
      CREATE INDEX idx_subscriptions_lemon_squeezy_id ON subscriptions(lemon_squeezy_id);
      CREATE INDEX idx_payment_history_user_id ON payment_history(user_id);
      CREATE INDEX idx_payment_history_created_at ON payment_history(created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_payment_history_created_at;
      DROP INDEX IF EXISTS idx_payment_history_user_id;
      DROP INDEX IF EXISTS idx_subscriptions_lemon_squeezy_id;
      DROP INDEX IF EXISTS idx_subscriptions_user_id;
      DROP TABLE IF EXISTS payment_history;
      DROP TABLE IF EXISTS subscriptions;
    `);
  }
}