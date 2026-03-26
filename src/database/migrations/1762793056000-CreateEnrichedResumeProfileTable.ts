import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEnrichedResumeProfileTable1762793056000 implements MigrationInterface {
  name = 'CreateEnrichedResumeProfileTable1762793056000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "enriched_resume_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "extracted_resume_content_id" uuid NOT NULL,
        "enriched_content" jsonb NOT NULL,
        "original_content" jsonb NOT NULL,
        "profile_completeness" float NOT NULL DEFAULT 0,
        "questions_total" integer NOT NULL DEFAULT 0,
        "questions_answered" integer NOT NULL DEFAULT 0,
        "version" integer NOT NULL DEFAULT 1,
        "last_enriched_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_enriched_resume_profiles" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      ALTER TABLE "enriched_resume_profiles"
      ADD CONSTRAINT "FK_enriched_resume_profiles_user"
      FOREIGN KEY ("user_id")
      REFERENCES "users"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      ALTER TABLE "enriched_resume_profiles"
      ADD CONSTRAINT "FK_enriched_resume_profiles_extracted_resume_content"
      FOREIGN KEY ("extracted_resume_content_id")
      REFERENCES "extracted_resume_contents"("id")
      ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_enriched_resume_profiles_user_id"
      ON "enriched_resume_profiles" ("user_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_enriched_resume_profiles_user_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "enriched_resume_profiles"
      DROP CONSTRAINT "FK_enriched_resume_profiles_extracted_resume_content"
    `);

    await queryRunner.query(`
      ALTER TABLE "enriched_resume_profiles"
      DROP CONSTRAINT "FK_enriched_resume_profiles_user"
    `);

    await queryRunner.query(`DROP TABLE "enriched_resume_profiles"`);
  }
}
