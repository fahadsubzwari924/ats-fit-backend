import type { ApplicationStatus } from '../../../database/entities/job-application.entity';

export interface IJobApplicationStatusHistoryEntry {
  from: ApplicationStatus | null;
  to: ApplicationStatus;
  changed_at: string;
  changed_by_user_id?: string;
  note?: string;
}
