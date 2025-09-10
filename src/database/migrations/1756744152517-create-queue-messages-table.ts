import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateQueueMessagesTable1756744152517
  implements MigrationInterface
{
  name = 'CreateQueueMessagesTable1756744152517';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create status enum
    await queryRunner.query(`
      CREATE TYPE "queue_messages_status_enum" AS ENUM(
        'queued', 
        'processing', 
        'completed', 
        'failed', 
        'retrying'
      )
    `);

    // Create priority enum
    await queryRunner.query(`
      CREATE TYPE "queue_messages_priority_enum" AS ENUM(
        'low', 
        'normal', 
        'high', 
        'critical'
      )
    `);

    // Create queue_messages table with comprehensive tracking
    await queryRunner.query(`
      CREATE TABLE "queue_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "queue_name" character varying(100) NOT NULL,
        "job_type" character varying(100) NOT NULL,
        "correlation_id" uuid,
        "user_id" uuid,
        "entity_name" character varying(100),
        "entity_id" character varying(255),
        "payload" jsonb NOT NULL,
        "result" jsonb,
        "status" "queue_messages_status_enum" NOT NULL DEFAULT 'queued',
        "priority" "queue_messages_priority_enum" NOT NULL DEFAULT 'normal',
        "attempts" integer NOT NULL DEFAULT 0,
        "max_attempts" integer NOT NULL DEFAULT 3,
        "queued_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "started_at" TIMESTAMP,
        "completed_at" TIMESTAMP,
        "processing_duration_ms" integer,
        "error_details" text,
        "metadata" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_queue_messages_id" PRIMARY KEY ("id")
      )
    `);

    // Create performance-optimized indexes for faster queries
    await queryRunner.query(`
      CREATE INDEX "IDX_queue_messages_queue_name_status" 
      ON "queue_messages" ("queue_name", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_queue_messages_job_type_status" 
      ON "queue_messages" ("job_type", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_queue_messages_user_id_status" 
      ON "queue_messages" ("user_id", "status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_queue_messages_entity_name_entity_id" 
      ON "queue_messages" ("entity_name", "entity_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_queue_messages_correlation_id" 
      ON "queue_messages" ("correlation_id")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_queue_messages_status_queued_at" 
      ON "queue_messages" ("status", "queued_at")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_queue_messages_retry_logic" 
      ON "queue_messages" ("status", "attempts", "max_attempts")
    `);

    // Create trigger for updated_at timestamp
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_queue_messages_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    await queryRunner.query(`
      CREATE TRIGGER update_queue_messages_updated_at 
      BEFORE UPDATE ON "queue_messages" 
      FOR EACH ROW EXECUTE PROCEDURE update_queue_messages_updated_at_column()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop trigger and function
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS update_queue_messages_updated_at ON "queue_messages"
    `);

    await queryRunner.query(`
      DROP FUNCTION IF EXISTS update_queue_messages_updated_at_column()
    `);

    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_queue_messages_retry_logic"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_queue_messages_status_queued_at"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_queue_messages_correlation_id"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_queue_messages_entity_name_entity_id"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_queue_messages_user_id_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_queue_messages_job_type_status"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_queue_messages_queue_name_status"
    `);

    // Drop table
    await queryRunner.query(`DROP TABLE IF EXISTS "queue_messages"`);

    // Drop enums
    await queryRunner.query(`
      DROP TYPE IF EXISTS "queue_messages_priority_enum"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "queue_messages_status_enum"
    `);
  }
}
