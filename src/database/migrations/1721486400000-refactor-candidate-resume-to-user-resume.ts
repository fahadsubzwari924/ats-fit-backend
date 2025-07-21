import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefactorCandidateResumeToUserResume1721486400000
  implements MigrationInterface
{
  name = 'RefactorCandidateResumeToUserResume1721486400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create user_resumes table
    await queryRunner.query(`
      CREATE TABLE "user_resumes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fileName" character varying(255) NOT NULL,
        "fileSize" integer NOT NULL,
        "mimeType" character varying(50) NOT NULL,
        "s3Url" character varying(512) NOT NULL,
        "description" text,
        "isActive" boolean NOT NULL DEFAULT true,
        "user_id" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_resumes_id" PRIMARY KEY ("id")
      )
    `);

    // Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "user_resumes" 
      ADD CONSTRAINT "FK_user_resumes_user_id" 
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // Drop candidate_resumes table if it exists
    await queryRunner.query(`DROP TABLE IF EXISTS "candidate_resumes"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop user_resumes table
    await queryRunner.query(`DROP TABLE "user_resumes"`);

    // Recreate candidate_resumes table
    await queryRunner.query(`
      CREATE TABLE "candidate_resumes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "candidateName" character varying(255) NOT NULL,
        "email" character varying(255) NOT NULL,
        "s3Url" character varying(255) NOT NULL,
        "fileName" character varying(255) NOT NULL,
        "fileSize" integer NOT NULL,
        "mimeType" character varying(50) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_candidate_resumes_id" PRIMARY KEY ("id")
      )
    `);
  }
}
