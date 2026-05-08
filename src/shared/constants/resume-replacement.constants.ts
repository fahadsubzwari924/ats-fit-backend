// src/shared/constants/resume-replacement.constants.ts
export const RESUME_REPLACEMENT = {
  PREMIUM_MONTHLY_LIMIT: 3,
  IDEMPOTENCY_REPLAY_WINDOW_SECONDS: 30,
  ARCHIVE_RETENTION_DAYS: 90,
  RESTORE_WINDOW_DAYS: 7,
  STUCK_JOB_THRESHOLD_MINUTES: 5,
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  ALLOWED_MIME_TYPES: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ] as const,
  IDEMPOTENCY_HEADER: 'Idempotency-Key',
} as const;
