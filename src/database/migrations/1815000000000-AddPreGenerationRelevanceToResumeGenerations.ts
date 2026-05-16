import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreGenerationRelevanceToResumeGenerations1815000000000 implements MigrationInterface {
  name = 'AddPreGenerationRelevanceToResumeGenerations1815000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE resume_generations
        ADD COLUMN pre_generation_relevance JSONB NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_resume_generations_relevance_verdict
        ON resume_generations ((pre_generation_relevance->>'verdict'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_resume_generations_relevance_verdict`,
    );
    await queryRunner.query(
      `ALTER TABLE resume_generations DROP COLUMN pre_generation_relevance`,
    );
  }
}
