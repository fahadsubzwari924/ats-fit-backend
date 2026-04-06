import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JobApplicationQueryDto } from './job-application-query.dto';

async function validateQuery(plain: Record<string, unknown>) {
  const dto = plainToInstance(JobApplicationQueryDto, plain, {
    enableImplicitConversion: true,
  });
  return validate(dto);
}

describe('JobApplicationQueryDto', () => {
  it('rejects sort_by not in whitelist', async () => {
    const errors = await validateQuery({ sort_by: 'priority' });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts sort_by created_at with sort_order DESC', async () => {
    const errors = await validateQuery({
      sort_by: 'created_at',
      sort_order: 'DESC',
      limit: '20',
      offset: '0',
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects applied_at_from after applied_at_to', async () => {
    const errors = await validateQuery({
      applied_at_from: '2024-02-01T00:00:00.000Z',
      applied_at_to: '2024-01-01T00:00:00.000Z',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects q longer than 200 characters', async () => {
    const errors = await validateQuery({ q: 'x'.repeat(201) });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid enum value in statuses', async () => {
    const errors = await validateQuery({ statuses: ['not_a_status'] });
    expect(errors.length).toBeGreaterThan(0);
  });
});
