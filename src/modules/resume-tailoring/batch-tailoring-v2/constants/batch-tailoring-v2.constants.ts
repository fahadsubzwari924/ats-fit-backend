export const BATCH_TAILORING_V2_QUEUE = 'batch_tailoring_v2' as const;
export const BATCH_TAILORING_V2_JOB_NAME = 'process_batch_job' as const;
export const BATCH_V2_MAX_JOBS = 3 as const;
export const BATCH_V2_WORKER_CONCURRENCY = 3 as const;
export const BATCH_V2_HEARTBEAT_MS = 20_000 as const;

export const BATCH_V2_SSE_EVENT_NAMES = {
  SNAPSHOT: 'snapshot',
  JOB_STARTED: 'job_started',
  JOB_PROGRESS: 'job_progress',
  JOB_COMPLETED: 'job_completed',
  JOB_FAILED: 'job_failed',
  BATCH_COMPLETED: 'batch_completed',
  HEARTBEAT: 'heartbeat',
} as const;
