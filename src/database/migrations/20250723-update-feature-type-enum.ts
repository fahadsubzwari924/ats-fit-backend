import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateFeatureTypeEnum1721486400001 implements MigrationInterface {
  name = 'UpdateFeatureTypeEnum1721486400001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE rate_limit_configs_feature_type_enum ADD VALUE 'ats_score_history';
    `);
  }

  public async down(): Promise<void> {
    // Note: Removing a value from an enum type is not directly supported in PostgreSQL.
    // You would need to recreate the enum type without the value, which is a complex operation.
  }
}
