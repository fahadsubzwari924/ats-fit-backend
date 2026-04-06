import { ApplicationSource } from '../../../database/entities/job-application.entity';
import { ICreateJobApplication } from '../interfaces/job-application.interface';

/**
 * Client may send `applied_at` (ISO). For tailored_resume without a valid date,
 * default to "now" so tracked applications show a sensible Applied date in the UI.
 */
export function resolveAppliedAtOnCreate(
  data: ICreateJobApplication,
): Date | undefined {
  if (data.applied_at?.trim()) {
    const parsed = new Date(data.applied_at);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  if (data.application_source === ApplicationSource.TAILORED_RESUME) {
    return new Date();
  }
  return undefined;
}
