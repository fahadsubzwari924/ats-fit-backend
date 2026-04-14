import { Process, Processor } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueMessage } from '../../../database/entities/queue-message.entity';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { QueueMessageStatus } from '../../../shared/enums/queue-message.enum';
import { ChangesDiffJobData } from '../interfaces/resume-extraction.interface';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import { ChangesDiffComputationService } from '../services/changes-diff-computation.service';

/**
 * Changes Diff Processor
 *
 * Consumes `compute_changes_diff` jobs from the `changes_diff` Bull queue.
 * Calls ChangesDiffComputationService to programmatically produce a structured,
 * bullet-point-level diff and saves it to resume_generations.changes_diff.
 *
 * Running as a background job keeps this out of the HTTP critical path,
 * so users receive their PDF immediately without waiting for diff computation.
 *
 * Domain: Resume Tailoring
 * Queue: changes_diff
 * Job Type: compute_changes_diff
 */
@Processor('changes_diff')
export class ChangesDiffProcessor implements OnModuleInit {
  private readonly logger = new Logger(ChangesDiffProcessor.name);

  constructor(
    @InjectRepository(QueueMessage)
    private readonly queueMessageRepository: Repository<QueueMessage>,
    @InjectRepository(ResumeGeneration)
    private readonly resumeGenerationRepository: Repository<ResumeGeneration>,
    private readonly changesDiffComputationService: ChangesDiffComputationService,
  ) {
    this.logger.log('ChangesDiffProcessor constructor called');
  }

  onModuleInit(): void {
    this.logger.log(
      'ChangesDiffProcessor initialized and ready to process jobs',
    );
  }

  @Process('compute_changes_diff')
  async handleChangesDiffComputation(
    job: Job<ChangesDiffJobData>,
  ): Promise<void> {
    const { queueMessageId, resumeGenerationId, userId } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `Starting changes diff computation for resume generation ${resumeGenerationId} (user ${userId})`,
      { queueMessageId, jobId: job.id },
    );

    try {
      this.assertJobData(job.data);

      await this.updateQueueMessageStatus(
        queueMessageId,
        QueueMessageStatus.PROCESSING,
      );
      await job.progress(10);

      const diff = this.changesDiffComputationService.computeDiff(
        job.data.originalContent as unknown as TailoredContent,
        job.data.optimizedContent as unknown as TailoredContent,
        job.data.jobAnalysisKeywords,
      );

      await job.progress(70);

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jsonb column typed as any on entity */
      await this.resumeGenerationRepository.update(
        { id: resumeGenerationId, user_id: userId },
        {
          changes_diff: diff as unknown as ResumeGeneration['changes_diff'],
        },
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */

      await job.progress(90);

      const processingDuration = Date.now() - startTime;

      await this.updateQueueMessageStatus(
        queueMessageId,
        QueueMessageStatus.COMPLETED,
        {
          processingDurationMs: processingDuration,
          result: {
            success: true,
            resumeGenerationId,
            totalChanges: diff.totalChanges,
            sectionsChanged: diff.sectionsChanged,
          },
        },
      );

      await job.progress(100);

      this.logger.log(
        `Changes diff computed and saved in ${processingDuration}ms for generation ${resumeGenerationId}: ${diff.totalChanges} changes across ${diff.sectionsChanged} sections`,
        { queueMessageId, resumeGenerationId },
      );
    } catch (error) {
      const processingDuration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Failed to compute changes diff for resume generation ${resumeGenerationId}: ${errorMessage}`,
        {
          queueMessageId,
          resumeGenerationId,
          processingDurationMs: processingDuration,
          error: error instanceof Error ? error.stack : undefined,
        },
      );

      await this.updateQueueMessageStatus(
        queueMessageId,
        QueueMessageStatus.FAILED,
        {
          errorDetails: errorMessage,
          processingDurationMs: processingDuration,
        },
      ).catch(() => {
        /* swallow status-update failure — do not mask the original error */
      });

      throw error;
    }
  }

  private assertJobData(data: ChangesDiffJobData): void {
    const requiredStrings: (keyof ChangesDiffJobData)[] = [
      'queueMessageId',
      'resumeGenerationId',
      'userId',
    ];
    for (const field of requiredStrings) {
      if (!data[field] || typeof data[field] !== 'string') {
        throw new Error(
          `Invalid job data: '${field}' is required and must be a non-empty string`,
        );
      }
    }
    if (!data.originalContent || typeof data.originalContent !== 'object') {
      throw new Error(
        `Invalid job data: 'originalContent' is required and must be an object`,
      );
    }
    if (!data.optimizedContent || typeof data.optimizedContent !== 'object') {
      throw new Error(
        `Invalid job data: 'optimizedContent' is required and must be an object`,
      );
    }
  }

  private async updateQueueMessageStatus(
    queueMessageId: string,
    status: QueueMessageStatus,
    additionalData?: {
      result?: Record<string, unknown>;
      errorDetails?: string;
      processingDurationMs?: number;
    },
  ): Promise<void> {
    const updateData: Partial<QueueMessage> = { status };

    if (status === QueueMessageStatus.PROCESSING) {
      updateData.startedAt = new Date();
    }

    if (
      status === QueueMessageStatus.COMPLETED ||
      status === QueueMessageStatus.FAILED
    ) {
      updateData.completedAt = new Date();
      if (additionalData?.processingDurationMs) {
        updateData.processingDurationMs = additionalData.processingDurationMs;
      }
    }

    if (additionalData?.result) {
      updateData.result = additionalData.result;
    }
    if (additionalData?.errorDetails) {
      updateData.errorDetails = additionalData.errorDetails;
    }

    await this.queueMessageRepository
      .createQueryBuilder()
      .update(QueueMessage)
      .set({
        ...updateData,
        attempts: () => 'attempts + 1',
      })
      .where('id = :id', { id: queueMessageId })
      .execute();

    this.logger.debug(
      `Updated queue message ${queueMessageId} status to ${status}`,
    );
  }
}
