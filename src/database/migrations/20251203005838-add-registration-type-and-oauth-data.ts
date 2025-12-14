import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddRegistrationTypeAndOauthData20251203005838
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the registration_type enum type
    await queryRunner.query(`
      CREATE TYPE "registration_type_enum" AS ENUM (
        'general',
        'google',
        'facebook',
        'apple',
        'github'
      );
    `);

    // Add registration_type column
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'registration_type',
        type: 'enum',
        enum: ['general', 'google', 'facebook', 'apple', 'github'],
        enumName: 'registration_type_enum',
        default: "'general'",
        isNullable: false,
      }),
    );

    // Add oauth_provider_data column
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'oauth_provider_data',
        type: 'jsonb',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop oauth_provider_data column
    await queryRunner.dropColumn('users', 'oauth_provider_data');

    // Drop registration_type column
    await queryRunner.dropColumn('users', 'registration_type');

    // Drop the enum type
    await queryRunner.query(`DROP TYPE "registration_type_enum";`);
  }
}
