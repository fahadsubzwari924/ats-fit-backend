import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BatchJobResult } from '../../dtos/batch-generate.dto';
import { BatchJobState } from '../../../../database/entities/batch-tailoring-job.entity';
import { BatchRunStatus } from '../../../../database/entities/batch-tailoring-run.entity';

export class BatchJobSnapshotEntryDto {
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

  @ApiPropertyOptional({
    description: 'Populated when state === "completed"',
  })
  result?: BatchJobResult;

  @ApiPropertyOptional({ description: 'Populated when state === "failed"' })
  error?: string;
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
