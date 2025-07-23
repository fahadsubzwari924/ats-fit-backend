import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAtsScoreHistoryRateLimit1721486400002
  implements MigrationInterface
{
  name = 'AddAtsScoreHistoryRateLimit1721486400002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO rate_limit_configs (plan, user_type, feature_type, monthly_limit, description, is_active, created_at, updated_at)
      VALUES
        ('freemium', 'guest', 'ats_score_history', 0, 'Guest users cannot fetch ATS score history', true, NOW(), NOW()),
        ('freemium', 'registered', 'ats_score_history', 7, 'Freemium registered users can fetch ATS score history for the last 1 week', true, NOW(), NOW()),
        ('premium', 'registered', 'ats_score_history', 60, 'Premium users can fetch ATS score history for the last 2 months', true, NOW(), NOW());
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM rate_limit_configs WHERE feature_type = 'ats_score_history';
    `);
  }
}
