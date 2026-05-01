import type {
  JobApplication,
  ApplicationStatus,
} from '../../../database/entities/job-application.entity';
import type { IJobApplicationStatusHistoryEntry } from '../interfaces/job-application-status-history.interface';

export function appendStatusHistoryIfChanged(
  previous: JobApplication,
  incomingStatus: ApplicationStatus | undefined,
  changedByUserId: string | undefined,
): IJobApplicationStatusHistoryEntry[] {
  const existing = previous.status_history ?? [];
  if (!incomingStatus || incomingStatus === previous.status) {
    return existing;
  }
  const entry: IJobApplicationStatusHistoryEntry = {
    from: previous.status ?? null,
    to: incomingStatus,
    changed_at: new Date().toISOString(),
    changed_by_user_id: changedByUserId,
  };
  return [...existing, entry];
}
