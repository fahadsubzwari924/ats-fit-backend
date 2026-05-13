import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BatchJobResult } from '../../dtos/batch-generate.dto';
import { BatchJobState } from '../../../../database/entities/batch-tailoring-job.entity';
import { BatchRunStatus } from '../../../../database/entities/batch-tailoring-run.entity';
import type { BatchJobError } from '../../interfaces/batch-job-error.interface';

export class BatchJobSnapshotEntryDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'DB UUID of the batch_tailoring_jobs row. Used by the FE as the `jobId` query parameter on the per-job retry endpoint.',
  })
  id: string;

  @ApiProperty({ description: 'Zero-based index of the job within the batch' })
  index: number;

  @ApiProperty()
  jobPosition: string;

  @ApiProperty()
  companyName: string;

  @ApiProperty({
    enum: [
      'queued',
      'analyzing',
      'optimizing',
      'finalizing',
      'completed',
      'failed',
    ],
  })
  state: BatchJobState;

  @ApiProperty({
    description:
      'Manual-retry count. The FE hides the retry button once this reaches the per-job retry cap (MAX_MANUAL_RETRIES = 2).',
  })
  retryCount: number;

  @ApiPropertyOptional({
    description: 'Populated when state === "completed"',
  })
  result?: BatchJobResult;

  @ApiPropertyOptional({
    description:
      'Typed failure envelope populated when state === "failed". Legacy plain-string rows are synthesized into this shape (`category: "UNKNOWN"`) at read time.',
  })
  error?: BatchJobError;
}

export class BatchSnapshotV2Dto {
  @ApiProperty({ format: 'uuid' })
  batchId: string;

  @ApiProperty()
  totalJobs: number;

  @ApiProperty({
    enum: ['queued', 'processing', 'completed', 'partial', 'failed'],
  })
  status: BatchRunStatus;

  @ApiProperty({ type: [BatchJobSnapshotEntryDto] })
  jobs: BatchJobSnapshotEntryDto[];
}
