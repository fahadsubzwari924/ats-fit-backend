import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPromptVersion20260430000001 implements MigrationInterface {
  name = 'AddPromptVersion20260430000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD COLUMN IF NOT EXISTS "prompt_version" VARCHAR(16) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN IF EXISTS "prompt_version"`,
    );
  }
}
