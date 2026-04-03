import { Process, Processor } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueMessage } from '../../../database/entities/queue-message.entity';
import { QueueMessageStatus } from '../../../shared/enums/queue-message.enum';
import { ResumeProfileEnrichmentService } from '../services/resume-profile-enrichment.service';
import { ProfileEnrichmentJobData } from '../interfaces/resume-extraction.interface';

/**
 * Resume Profile Enrichment Processor
 *
 * Single responsibility: orchestrate the enrich_profile background job.
 * Delegates all enrichment logic to ResumeProfileEnrichmentService.
 *
 * Running enrichment in a Bull worker decouples it from the HTTP request
 * lifecycle, preventing the answer endpoint from blocking on a ~5-39s
 * Claude API call.
 *
 * Domain: Resume Tailoring
 * Queue: profile_enrichment
 * Job Type: enrich_profile
 */
@Processor('profile_enrichment')
export class ResumeProfileEnrichmentProcessor implements OnModuleInit {
  private readonly logger = new Logger(ResumeProfileEnrichmentProcessor.name);

  constructor(
    @InjectRepository(QueueMessage)
    private readonly queueMessageRepository: Repository<QueueMessage>,
    private readonly resumeProfileEnrichmentService: ResumeProfileEnrichmentService,
  ) {
    this.logger.log('ResumeProfileEnrichmentProcessor constructor called');
  }

  onModuleInit(): void {
    this.logger.log(
      'ResumeProfileEnrichmentProcessor initialized and ready to process jobs',
    );
  }

  @Process('enrich_profile')
  async handleProfileEnrichment(
    job: Job<ProfileEnrichmentJobData>,
  ): Promise<void> {
    const { queueMessageId, userId } = job.data;
    const startTime = Date.now();

    this.logger.log(`Starting profile enrichment for user ${userId}`, {
      queueMessageId,
      jobId: job.id,
    });

    try {
      this.assertJobData(job.data);

      await this.updateQueueMessageStatus(
        queueMessageId,
        QueueMessageStatus.PROCESSING,
      );
      await job.progress(10);

      const enrichedProfile =
        await this.resumeProfileEnrichmentService.enrichProfile(userId);
      await job.progress(90);

      const processingDuration = Date.now() - startTime;

      await this.updateQueueMessageStatus(
        queueMessageId,
        QueueMessageStatus.COMPLETED,
        {
          processingDurationMs: processingDuration,
          result: {
            success: true,
            enrichedProfileId: enrichedProfile.id,
            profileCompleteness: enrichedProfile.profileCompleteness,
            version: enrichedProfile.version,
          },
        },
      );
      await job.progress(100);

      this.logger.log(
        `Successfully enriched profile for user ${userId} in ${processingDuration}ms`,
        {
          queueMessageId,
          enrichedProfileId: enrichedProfile.id,
          processingDurationMs: processingDuration,
        },
      );
    } catch (error) {
      const processingDuration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Failed to enrich profile for user ${userId}: ${errorMessage}`,
        {
          queueMessageId,
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
      );

      throw error;
    }
  }

  private assertJobData(data: ProfileEnrichmentJobData): void {
    const requiredFields: (keyof ProfileEnrichmentJobData)[] = [
      'queueMessageId',
      'userId',
    ];
    for (const field of requiredFields) {
      if (!data[field] || typeof data[field] !== 'string') {
        throw new Error(
          `Invalid job data: '${field}' is required and must be a non-empty string`,
        );
      }
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

    this.logger.log(
      `Updated queue message ${queueMessageId} status to ${status}`,
    );
  }
}
