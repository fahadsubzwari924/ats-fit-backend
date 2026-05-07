import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCoverLetterToResumeGeneration1814725000000 implements MigrationInterface {
  name = 'AddCoverLetterToResumeGeneration1814725000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" ADD "cover_letter" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "resume_generations" DROP COLUMN "cover_letter"`,
    );
  }
}
