import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill `job_applications` rows for every prior `resume_generations`
 * that never produced a tracked application (FE-tracking dismiss-path bug
 * pre-dating the move to BE-owned tracking).
 *
 * Uses `ON CONFLICT DO NOTHING` against the partial unique index added in
 * AddUniqueResumeGenerationOnJobApplications1815100000000 so the backfill
 * is safe to re-run.
 *
 * `userId` (camelCase, FK) is preferred when present because the legacy
 * `user_id` column is `varchar`; `COALESCE` keeps either source viable.
 */
export class BackfillMissingTrackedApplications1815100100000 implements MigrationInterface {
  name = 'BackfillMissingTrackedApplications1815100100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO job_applications (
        user_id,
        resume_generation_id,
        company_name,
        job_position,
        job_description,
        application_source,
        status,
        applied_at,
        created_at,
        updated_at,
        status_history
      )
      SELECT
        COALESCE(rg."userId"::text, rg.user_id)::uuid,
        rg.id,
        COALESCE(NULLIF(TRIM(rg.company_name), ''), 'Unknown Company'),
        COALESCE(NULLIF(TRIM(rg.job_position), ''), 'Unknown Position'),
        rg.job_description,
        'tailored_resume',
        'applied',
        rg.created_at,
        rg.created_at,
        rg.created_at,
        jsonb_build_array(jsonb_build_object(
          'from', NULL,
          'to', 'applied',
          'changed_at', to_char(rg.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'changed_by_user_id', COALESCE(rg."userId"::text, rg.user_id)
        ))
      FROM resume_generations rg
      WHERE COALESCE(rg."userId"::text, rg.user_id) IS NOT NULL
        -- Guard against malformed legacy varchar user_id values that arent
        -- valid uuids. The destination column job_applications.user_id is
        -- typed uuid, so a non-uuid string would abort the whole INSERT.
        -- The regex matches the canonical 8-4-4-4-12 hex form.
        AND COALESCE(rg."userId"::text, rg.user_id) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        AND NOT EXISTS (
          SELECT 1
          FROM job_applications ja
          WHERE ja.resume_generation_id = rg.id
        )
      -- ON CONFLICT inference must match the partial index predicate
      -- (resume_generation_id) WHERE resume_generation_id IS NOT NULL.
      -- ON CONSTRAINT name does NOT work here because the underlying
      -- object is a partial UNIQUE INDEX, not a named constraint
      -- (pg_constraint has no row for it).
      ON CONFLICT (resume_generation_id) WHERE resume_generation_id IS NOT NULL
      DO NOTHING
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentional no-op. We cannot reliably distinguish backfilled rows
    // from user-edited ones at down-migration time; safer to leave history
    // intact than to risk deleting real user data.
  }
}
