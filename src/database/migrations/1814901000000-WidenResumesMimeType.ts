import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenResumesMimeType1814901000000 implements MigrationInterface {
  name = 'WidenResumesMimeType1814901000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_resumes" ALTER COLUMN "mimeType" TYPE varchar(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_resumes" ALTER COLUMN "mimeType" TYPE varchar(50)`,
    );
  }
}
