import { ValueTransformer } from 'typeorm';

/**
 * TypeORM `ValueTransformer` that coerces Postgres `numeric` / `decimal` column
 * values (returned by node-postgres as strings to preserve arbitrary precision)
 * into JS `number` on read.
 *
 * Why this exists:
 *   Postgres returns `numeric` / `decimal` columns over the wire as text. The
 *   `pg` driver hands those back to TypeORM as strings, even when the entity
 *   field is typed `number`. Without this transformer, anywhere downstream that
 *   trusts the TS type (arithmetic, JSON responses sent to a typed FE form,
 *   class-validator's `@IsNumber()` on a round-tripped payload) silently
 *   misbehaves.
 *
 *   This was the root cause of "salary_min must be a number" on the job
 *   application edit flow — the FE loaded the entity's serialized string,
 *   placed it into a reactive form unchanged, and re-submitted it on save.
 *   The BE DTO's `@IsNumber()` then rejected its own previously-emitted value.
 *
 * Precision trade-off:
 *   `Number()` is lossy beyond 2^53. For currency / quota numbers up to
 *   precision=12 scale=2 (range ±9_999_999_999.99) we are well inside JS safe
 *   integer territory, so this is safe for our schema. If we ever store a
 *   numeric column needing more precision, switch that specific column to
 *   `string` in TS and skip this transformer for it.
 *
 * Null handling:
 *   Pass `null` and `undefined` through unchanged so nullable columns continue
 *   to round-trip cleanly.
 */
export const decimalToNumberTransformer: ValueTransformer = {
  to: (value: number | null | undefined): number | null | undefined => value,
  from: (value: string | null | undefined): number | null => {
    // Two early returns (instead of `return value`) keep the function's
    // declared return type honest: after the null/undefined check, `value` is
    // `string`, which is not assignable to `number | null`. Returning `null`
    // for both absent cases also gives downstream consumers a single sentinel
    // to check for "no salary set", which is friendlier than juggling
    // `undefined` vs `null`.
    if (value === null) return null;
    if (value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  },
};
