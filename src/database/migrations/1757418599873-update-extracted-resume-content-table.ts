import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateExtractedResumeContentTable1757418599873 implements MigrationInterface {
    name = 'UpdateExtractedResumeContentTable1757418599873'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP CONSTRAINT "FK_extracted_resume_contents_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_queue_messages_queue_name_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_queue_messages_job_type_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_queue_messages_user_id_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_queue_messages_entity_name_entity_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_queue_messages_correlation_id"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_queue_messages_status_queued_at"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_queue_messages_retry_logic"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_extracted_resume_contents_user_id_status"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_extracted_resume_contents_original_file_name"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_extracted_resume_contents_created_at"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP COLUMN "processing_status"`);
        await queryRunner.query(`DROP TYPE "public"."extracted_resume_contents_processing_status_enum"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP COLUMN "error_message"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP COLUMN "processing_started_at"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP COLUMN "processing_completed_at"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP COLUMN "processing_duration_ms"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP COLUMN "metadata"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD "queue_message_id" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD "business_metadata" jsonb NOT NULL DEFAULT '{}'`);
        await queryRunner.query(`ALTER TABLE "queue_messages" ALTER COLUMN "queued_at" SET DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "queue_messages" ALTER COLUMN "created_at" SET DEFAULT now()`);
        await queryRunner.query(`ALTER TABLE "queue_messages" ALTER COLUMN "updated_at" SET DEFAULT now()`);
        await queryRunner.query(`CREATE INDEX "IDX_73fa506e7d32c6689624270f0f" ON "queue_messages" ("status", "attempts", "max_attempts") `);
        await queryRunner.query(`CREATE INDEX "IDX_55ff14f135000b8fd3c64fe6ec" ON "queue_messages" ("status", "queued_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_d9817181e2aec29462a1ac0265" ON "queue_messages" ("correlation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_ab763366ae0852f4a5981b39e1" ON "queue_messages" ("entity_name", "entity_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_e55a8b06acc50b03ec17c262d8" ON "queue_messages" ("user_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_74a9bd9e701c0a8ad8aa9e270d" ON "queue_messages" ("job_type", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_533139149603462e5c6b8dea3b" ON "queue_messages" ("queue_name", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_52993b285083ab2053996176d5" ON "extracted_resume_contents" ("last_used_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_177e1d803446238c7aa73cc966" ON "extracted_resume_contents" ("file_hash") `);
        await queryRunner.query(`CREATE INDEX "IDX_00aea7c1060f12d22b997722d0" ON "extracted_resume_contents" ("original_file_name") `);
        await queryRunner.query(`CREATE INDEX "IDX_0bdd6b7b807a4e41f7fcb9fc2b" ON "extracted_resume_contents" ("queue_message_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_7481d6b5408c4ca8790d27f3f1" ON "extracted_resume_contents" ("user_id") `);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD CONSTRAINT "FK_7481d6b5408c4ca8790d27f3f1a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD CONSTRAINT "FK_0bdd6b7b807a4e41f7fcb9fc2b3" FOREIGN KEY ("queue_message_id") REFERENCES "queue_messages"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP CONSTRAINT "FK_0bdd6b7b807a4e41f7fcb9fc2b3"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP CONSTRAINT "FK_7481d6b5408c4ca8790d27f3f1a"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_7481d6b5408c4ca8790d27f3f1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_0bdd6b7b807a4e41f7fcb9fc2b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_00aea7c1060f12d22b997722d0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_177e1d803446238c7aa73cc966"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_52993b285083ab2053996176d5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_533139149603462e5c6b8dea3b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_74a9bd9e701c0a8ad8aa9e270d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_e55a8b06acc50b03ec17c262d8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_ab763366ae0852f4a5981b39e1"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d9817181e2aec29462a1ac0265"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_55ff14f135000b8fd3c64fe6ec"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_73fa506e7d32c6689624270f0f"`);
        await queryRunner.query(`ALTER TABLE "queue_messages" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "queue_messages" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "queue_messages" ALTER COLUMN "queued_at" SET DEFAULT CURRENT_TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP COLUMN "business_metadata"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" DROP COLUMN "queue_message_id"`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD "metadata" jsonb`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD "processing_duration_ms" integer`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD "processing_completed_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD "processing_started_at" TIMESTAMP`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD "error_message" text`);
        await queryRunner.query(`CREATE TYPE "public"."extracted_resume_contents_processing_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed')`);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD "processing_status" "public"."extracted_resume_contents_processing_status_enum" NOT NULL DEFAULT 'pending'`);
        await queryRunner.query(`CREATE INDEX "IDX_extracted_resume_contents_created_at" ON "extracted_resume_contents" ("created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_extracted_resume_contents_original_file_name" ON "extracted_resume_contents" ("original_file_name") `);
        await queryRunner.query(`CREATE INDEX "IDX_extracted_resume_contents_user_id_status" ON "extracted_resume_contents" ("user_id", "processing_status") `);
        await queryRunner.query(`CREATE INDEX "IDX_queue_messages_retry_logic" ON "queue_messages" ("status", "attempts", "max_attempts") `);
        await queryRunner.query(`CREATE INDEX "IDX_queue_messages_status_queued_at" ON "queue_messages" ("status", "queued_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_queue_messages_correlation_id" ON "queue_messages" ("correlation_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_queue_messages_entity_name_entity_id" ON "queue_messages" ("entity_name", "entity_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_queue_messages_user_id_status" ON "queue_messages" ("user_id", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_queue_messages_job_type_status" ON "queue_messages" ("job_type", "status") `);
        await queryRunner.query(`CREATE INDEX "IDX_queue_messages_queue_name_status" ON "queue_messages" ("queue_name", "status") `);
        await queryRunner.query(`ALTER TABLE "extracted_resume_contents" ADD CONSTRAINT "FK_extracted_resume_contents_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
