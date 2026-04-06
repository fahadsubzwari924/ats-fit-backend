# ATS Scoring Phase 2 DB Cleanup (Optional)

This document defines the destructive database cleanup for ATS scoring after
the runtime cleanup has been stable in production.

## Preconditions

- Runtime/API/frontend ATS scoring paths have been removed and deployed.
- No active consumers depend on ATS-specific fields or tables.
- A full production database backup is available.
- Cleanup is executed in a maintenance window.

## Scope

Remove ATS scoring schema artifacts:

- Table: `ats_match_histories`
- Job application columns:
  - `job_applications.ats_score`
  - `job_applications.ats_analysis`
  - `job_applications.ats_match_history_id`
- Resume generation result columns:
  - `resume_generation_results.ats_score`
  - `resume_generation_results.ats_confidence`
  - `resume_generation_results.ats_match_history_id`
- Enum values in:
  - `usage_tracking_feature_type_enum`
  - `rate_limit_configs_feature_type_enum`

## Migration Order

1. Drop foreign key from `job_applications.ats_match_history_id`.
2. Drop ATS columns from `job_applications`.
3. Drop ATS columns from `resume_generation_results`.
4. Drop index(es) related to `ats_match_histories`.
5. Drop `ats_match_histories` table.
6. Rewrite enum types to remove ATS values.

## Enum Rewrite Strategy (PostgreSQL)

PostgreSQL does not safely support removing enum values in place. Use
create/cast/swap:

1. Create new enum without ATS values.
2. Alter dependent columns to `text`.
3. Cast from `text` to the new enum.
4. Drop old enum and rename new enum to old name.

## Rollback Strategy

- If migration fails before dropping objects, rollback transaction.
- If migration succeeds and rollback is required, restore from backup and
  redeploy the pre-cleanup app version.

## Validation Checklist

- `job_applications` CRUD still works.
- `resume_generation_results` read/write still works.
- `users/feature-usage` and `rate-limits/usage` still return valid data.
- No references to ATS columns/tables in query logs.

