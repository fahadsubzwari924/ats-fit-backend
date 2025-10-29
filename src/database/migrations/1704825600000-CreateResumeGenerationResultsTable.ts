import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Migration: Create Resume Generation Results Table
 *
 * Creates the resume_generation_results table for storing async resume generation results.
 * This table follows the same pattern as queue_messages but stores business data.
 *
 * Features:
 * - Stores generated PDF content (base64) or S3 URLs
 * - Links to queue_messages for audit trail
 * - Auto-expires after 7 days
 * - Optimized indexes for fast lookups
 */
export class CreateResumeGenerationResultsTable1704825600000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create resume_generation_results table
    await queryRunner.createTable(
      new Table({
        name: 'resume_generation_results',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          // Relationships
          {
            name: 'queue_message_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'user_id',
            type: 'uuid',
            isNullable: true,
          },
          {
            name: 'guest_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          // PDF Storage
          {
            name: 'pdf_content',
            type: 'text',
            isNullable: true,
            comment: 'Base64 encoded PDF content',
          },
          {
            name: 'pdf_url',
            type: 'varchar',
            length: '500',
            isNullable: true,
            comment: 'S3 URL if using cloud storage',
          },
          {
            name: 'filename',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'file_size_bytes',
            type: 'int',
          },
          // Generation Details
          {
            name: 'resume_generation_id',
            type: 'uuid',
            comment: 'Reference to resume_generations table',
          },
          {
            name: 'ats_score',
            type: 'int',
          },
          {
            name: 'ats_confidence',
            type: 'int',
            default: 0,
          },
          {
            name: 'ats_match_history_id',
            type: 'uuid',
            isNullable: true,
          },
          // Request Metadata
          {
            name: 'template_id',
            type: 'varchar',
            length: '50',
          },
          {
            name: 'company_name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'job_position',
            type: 'varchar',
            length: '255',
          },
          // Optimization Metrics
          {
            name: 'keywords_added',
            type: 'int',
            default: 0,
          },
          {
            name: 'sections_optimized',
            type: 'int',
            default: 0,
          },
          {
            name: 'optimization_confidence',
            type: 'int',
            default: 0,
          },
          // Processing Metrics
          {
            name: 'processing_metrics',
            type: 'jsonb',
            isNullable: true,
            comment: 'Detailed processing time metrics',
          },
          // Additional Metadata
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          // Timestamps
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'expires_at',
            type: 'timestamp',
            default: "CURRENT_TIMESTAMP + INTERVAL '7 days'",
            comment: 'Auto-expire results after 7 days',
          },
        ],
        foreignKeys: [
          {
            name: 'fk_resume_generation_results_queue_message',
            columnNames: ['queue_message_id'],
            referencedTableName: 'queue_messages',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            name: 'fk_resume_generation_results_user',
            columnNames: ['user_id'],
            referencedTableName: 'users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    // Create indexes for performance
    await queryRunner.createIndex(
      'resume_generation_results',
      new TableIndex({
        name: 'idx_resume_generation_results_user_id',
        columnNames: ['user_id'],
      }),
    );

    await queryRunner.createIndex(
      'resume_generation_results',
      new TableIndex({
        name: 'idx_resume_generation_results_guest_id',
        columnNames: ['guest_id'],
      }),
    );

    await queryRunner.createIndex(
      'resume_generation_results',
      new TableIndex({
        name: 'idx_resume_generation_results_queue_message_id',
        columnNames: ['queue_message_id'],
      }),
    );

    await queryRunner.createIndex(
      'resume_generation_results',
      new TableIndex({
        name: 'idx_resume_generation_results_expires_at',
        columnNames: ['expires_at'],
      }),
    );

    await queryRunner.createIndex(
      'resume_generation_results',
      new TableIndex({
        name: 'idx_resume_generation_results_user_created',
        columnNames: ['user_id', 'created_at'],
      }),
    );

    // Create trigger for updated_at
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION update_resume_generation_results_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql';
    `);

    await queryRunner.query(`
      CREATE TRIGGER update_resume_generation_results_updated_at
        BEFORE UPDATE ON resume_generation_results
        FOR EACH ROW
        EXECUTE FUNCTION update_resume_generation_results_updated_at_column();
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop trigger
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS update_resume_generation_results_updated_at ON resume_generation_results;`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS update_resume_generation_results_updated_at_column();`,
    );

    // Drop indexes
    await queryRunner.dropIndex(
      'resume_generation_results',
      'idx_resume_generation_results_user_created',
    );
    await queryRunner.dropIndex(
      'resume_generation_results',
      'idx_resume_generation_results_expires_at',
    );
    await queryRunner.dropIndex(
      'resume_generation_results',
      'idx_resume_generation_results_queue_message_id',
    );
    await queryRunner.dropIndex(
      'resume_generation_results',
      'idx_resume_generation_results_guest_id',
    );
    await queryRunner.dropIndex(
      'resume_generation_results',
      'idx_resume_generation_results_user_id',
    );

    // Drop table
    await queryRunner.dropTable('resume_generation_results');
  }
}
