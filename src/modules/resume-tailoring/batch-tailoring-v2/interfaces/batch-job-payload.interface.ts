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
  /**
   * Mirror of the batch-level `acknowledgeLowFit` flag, threaded per-job so the
   * orchestrator's per-job low-fit guard can honor the batch-wide ack. Without
   * this, a batch that the user explicitly acknowledged on the warning step
   * still gets individual jobs aborted by the orchestrator when their verdict
   * is `low` — the user already saw and dismissed that warning at the batch
   * gate, so the per-job gate must defer.
   */
  acknowledgeLowFit?: boolean;
}
