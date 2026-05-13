import type { BatchJobResult } from '../../dtos/batch-generate.dto';
import type { BatchJobState } from '../../../../database/entities/batch-tailoring-job.entity';
import type { BatchRunStatus } from '../../../../database/entities/batch-tailoring-run.entity';
import type { BatchJobError } from '../../interfaces/batch-job-error.interface';

export type ProcessingStage = 'analyzing' | 'optimizing' | 'finalizing';

export interface SnapshotEvent {
  batchId: string;
  totalJobs: number;
  status: BatchRunStatus;
  jobs: Array<{
    /**
     * DB UUID of the batch_tailoring_jobs row. The FE keys retry actions off
     * this value — it's the `jobId` query parameter on the retry endpoint.
     */
    id: string;
    index: number;
    jobPosition: string;
    companyName: string;
    state: BatchJobState;
    /**
     * Number of manual retries that have already been consumed. The FE hides
     * the retry button once this reaches the MAX_MANUAL_RETRIES floor (2).
     */
    retryCount: number;
    result?: BatchJobResult;
    /**
     * Typed failure envelope on jobs in the `failed` state. Legacy plain-
     * string `error_message` rows are synthesized into this shape at read
     * time by the service-layer mapper.
     */
    error?: BatchJobError;
  }>;
}

export interface JobStartedEvent {
  batchId: string;
  /**
   * DB UUID of the batch_tailoring_jobs row. Emitted alongside `jobIndex`
   * (additive — both are present) so the FE can match SSE updates to rows
   * even when the index is no longer stable (e.g. across a retry).
   */
  jobId: string;
  jobIndex: number;
  stage: 'analyzing';
}

export interface JobProgressEvent {
  batchId: string;
  jobId: string;
  jobIndex: number;
  stage: ProcessingStage;
}

export interface JobCompletedEvent {
  batchId: string;
  jobId: string;
  jobIndex: number;
  result: BatchJobResult;
}

export interface JobFailedEvent {
  batchId: string;
  jobId: string;
  jobIndex: number;
  /** Typed failure envelope — same shape used by the snapshot/status APIs. */
  error: BatchJobError;
}

export interface BatchCompletedEvent {
  batchId: string;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    totalProcessingTimeMs: number;
  };
}
