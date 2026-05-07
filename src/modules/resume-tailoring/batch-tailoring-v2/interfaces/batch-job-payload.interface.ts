import type { UserContext } from '../../interfaces/user-context.interface';

export interface BatchJobPayloadV2 {
  batchId: string;
  batchJobId: string;
  jobIndex: number;
  totalJobs: number;
  userId: string;
  jobPosition: string;
  companyName: string;
  jobDescription: string;
  templateId: string;
  resumeId?: string;
  userContext: UserContext;
}
