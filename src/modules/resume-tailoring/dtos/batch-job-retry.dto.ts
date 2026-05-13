import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO for the per-job retry endpoint
 * (`POST /api/v1/resume-tailoring/batch/v2/:batchId/jobs/:jobId/retry`).
 *
 * The endpoint is fire-and-forget on the BE side: it re-enqueues the failed
 * job and returns immediately. The actual state transitions
 * (`queued → analyzing → optimizing → finalizing → completed | failed`)
 * are pushed through the existing SSE channel for the batch — the FE MUST
 * NOT optimistically update the row from this response. See Task E.
 */
export class BatchJobRetryResponseDto {
  @ApiProperty({
    description: 'Always `true` on a successful retry enqueue.',
    example: true,
  })
  ok: true;

  @ApiProperty({
    description: 'UUID of the job that was retried.',
    example: '03daae52-08ff-4eba-9da7-7f2342bf6a0c',
  })
  jobId: string;

  @ApiProperty({
    description:
      'Updated manual-retry counter for this job after this retry was enqueued. Hard cap is 2 — further retries return HTTP 429 with code ERR_RETRY_LIMIT_EXCEEDED.',
    example: 1,
    minimum: 1,
    maximum: 2,
  })
  retryCount: number;
}
