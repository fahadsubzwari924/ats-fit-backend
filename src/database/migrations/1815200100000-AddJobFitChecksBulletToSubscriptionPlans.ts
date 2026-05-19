import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the "100 job-fit checks per month" bullet to existing
 * `subscription_plans.features` JSON arrays for Pro plans.
 *
 * The seed scripts at `src/scripts/seed/seed-subscription-plans*.ts` were
 * updated to include this bullet, but they short-circuit when rows already
 * exist (`if (existingPlansCount > 0) skip`), so deployed environments that
 * were already seeded would otherwise miss the change. This migration
 * idempotently patches the JSON column in place.
 *
 * Safe to re-run — uses a JSON `?` containment check so the bullet is only
 * appended when it isn't already present.
 */
export class AddJobFitChecksBulletToSubscriptionPlans1815200100000 implements MigrationInterface {
  name = 'AddJobFitChecksBulletToSubscriptionPlans1815200100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The features JSONB is an array. Append the new bullet right after the
    // existing "15 cover letters per month" entry so visual ordering stays
    // consistent with the seed-script source of truth (tailored → cover →
    // job-fit → batch → ...). We use jsonb_path_query / array surgery to
    // insert at index 2 (zero-based — between the cover-letter entry at [1]
    // and whatever comes next).
    //
    // Only patches Pro plans (plan_name LIKE 'Pro%') and only when the
    // bullet isn't already present anywhere in the array — second condition
    // makes the migration idempotent.
    await queryRunner.query(`
      UPDATE subscription_plans
      SET features =
        jsonb_insert(
          features,
          '{2}'::text[],
          '"100 job-fit checks per month"'::jsonb,
          false
        )
      WHERE plan_name LIKE 'Pro%'
        AND NOT (
          features::text LIKE '%job-fit checks%'
        );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the bullet from any plan whose features array contains it.
    // Uses jsonb array filter — strips matching string entries while leaving
    // every other element (and structured entries like the Batch tailoring
    // object) intact.
    await queryRunner.query(`
      UPDATE subscription_plans
      SET features = (
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements(features) AS elem
        WHERE elem::text <> '"100 job-fit checks per month"'
      )
      WHERE plan_name LIKE 'Pro%'
        AND features::text LIKE '%job-fit checks%';
    `);
  }
}
