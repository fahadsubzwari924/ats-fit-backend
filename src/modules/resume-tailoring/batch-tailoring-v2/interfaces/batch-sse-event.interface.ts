import type { BatchJobResult } from '../../dtos/batch-generate.dto';
import type { BatchJobState } from '../../../../database/entities/batch-tailoring-job.entity';
import type { BatchRunStatus } from '../../../../database/entities/batch-tailoring-run.entity';

export type ProcessingStage = 'analyzing' | 'optimizing' | 'finalizing';

export interface SnapshotEvent {
  batchId: string;
  totalJobs: number;
  status: BatchRunStatus;
  jobs: Array<{
    index: number;
    jobPosition: string;
    companyName: string;
    state: BatchJobState;
    result?: BatchJobResult;
    error?: string;
  }>;
}

export interface JobStartedEvent {
  batchId: string;
  jobIndex: number;
  stage: 'analyzing';
}

export interface JobProgressEvent {
  batchId: string;
  jobIndex: number;
  stage: ProcessingStage;
}

export interface JobCompletedEvent {
  batchId: string;
  jobIndex: number;
  result: BatchJobResult;
}

export interface JobFailedEvent {
  batchId: string;
  jobIndex: number;
  error: string;
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
