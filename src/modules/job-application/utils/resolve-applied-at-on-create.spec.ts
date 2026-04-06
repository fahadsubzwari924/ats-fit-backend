import { ApplicationSource } from '../../../database/entities/job-application.entity';
import { resolveAppliedAtOnCreate } from './resolve-applied-at-on-create';

describe('resolveAppliedAtOnCreate', () => {
  const base = {
    company_name: 'Acme',
    job_position: 'Engineer',
    job_description: 'x'.repeat(25),
    application_source: ApplicationSource.TAILORED_RESUME,
  };

  it('uses client ISO string when valid', () => {
    const iso = '2024-06-15T12:00:00.000Z';
    const d = resolveAppliedAtOnCreate({ ...base, applied_at: iso });
    expect(d?.toISOString()).toBe(iso);
  });

  it('defaults to now for tailored_resume when applied_at omitted', () => {
    const before = Date.now();
    const d = resolveAppliedAtOnCreate({ ...base });
    expect(d).toBeDefined();
    expect(d!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(d!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('returns undefined for direct_apply without applied_at', () => {
    expect(
      resolveAppliedAtOnCreate({
        ...base,
        application_source: ApplicationSource.DIRECT_APPLY,
      }),
    ).toBeUndefined();
  });

  it('ignores invalid applied_at string and falls through to tailored default', () => {
    const before = Date.now();
    const d = resolveAppliedAtOnCreate({
      ...base,
      applied_at: 'not-a-date',
    });
    expect(d).toBeDefined();
    expect(d!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });
});
