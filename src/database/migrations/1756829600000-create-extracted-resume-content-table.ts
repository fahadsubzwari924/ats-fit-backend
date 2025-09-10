import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExtractedResumeContentTable1756829600000
  implements MigrationInterface
{
  name = 'CreateExtractedResumeContentTable1756829600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "extracted_resume_contents_processing_status_enum" AS ENUM(
        'pending', 
        'processing', 
        'completed', 
        'failed'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "extracted_resume_contents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "original_file_name" character varying(255) NOT NULL,
        "file_size" integer NOT NULL,
        "file_hash" character varying(64) NOT NULL,
        "extracted_text" text NOT NULL,
        "structured_content" jsonb NOT NULL,
        "processing_status" "extracted_resume_contents_processing_status_enum" NOT NULL DEFAULT 'pending',
        "error_message" text,
        "processing_started_at" TIMESTAMP,
        "processing_completed_at" TIMESTAMP,
        "processing_duration_ms" integer,
        "usage_count" integer NOT NULL DEFAULT '0',
        "last_used_at" TIMESTAMP,
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_extracted_resume_contents_file_hash" UNIQUE ("file_hash"),
        CONSTRAINT "PK_extracted_resume_contents" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_extracted_resume_contents_user_id_status" 
      ON "extracted_resume_contents" ("user_id", "processing_status")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_extracted_resume_contents_original_file_name" 
      ON "extracted_resume_contents" ("original_file_name")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_extracted_resume_contents_created_at" 
      ON "extracted_resume_contents" ("created_at")
    `);

    await queryRunner.query(`
      ALTER TABLE "extracted_resume_contents" 
      ADD CONSTRAINT "FK_extracted_resume_contents_user_id" 
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // Add trigger for updated_at
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    await queryRunner.query(`
      CREATE TRIGGER update_extracted_resume_contents_updated_at 
      BEFORE UPDATE ON extracted_resume_contents 
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS update_extracted_resume_contents_updated_at 
      ON extracted_resume_contents
    `);

    await queryRunner.query(`
      ALTER TABLE "extracted_resume_contents" 
      DROP CONSTRAINT "FK_extracted_resume_contents_user_id"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_extracted_resume_contents_created_at"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_extracted_resume_contents_original_file_name"
    `);

    await queryRunner.query(`
      DROP INDEX "IDX_extracted_resume_contents_user_id_status"
    `);

    await queryRunner.query(`
      DROP TABLE "extracted_resume_contents"
    `);

    await queryRunner.query(`
      DROP TYPE "extracted_resume_contents_processing_status_enum"
    `);

    await queryRunner.query(`
      DROP FUNCTION IF EXISTS update_updated_at_column()
    `);
  }
}
