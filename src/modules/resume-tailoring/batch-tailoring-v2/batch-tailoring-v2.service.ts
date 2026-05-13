import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bull';
import { DataSource, Repository } from 'typeorm';
import { BatchTailoringRun } from '../../../database/entities/batch-tailoring-run.entity';
import { BatchTailoringJob } from '../../../database/entities/batch-tailoring-job.entity';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { User } from '../../../database/entities/user.entity';
import {
  BadRequestException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { generateResumeFilename } from '../../../shared/utils/resume-filename.util';
import {
  BATCH_V2_MAX_JOBS,
  BATCH_TAILORING_V2_JOB_NAME,
  BATCH_TAILORING_V2_QUEUE,
} from './constants/batch-tailoring-v2.constants';
import type { BatchJobPayloadV2 } from './interfaces/batch-job-payload.interface';
import type { SnapshotEvent } from './interfaces/batch-sse-event.interface';
import type { UserContext } from '../interfaces/user-context.interface';
import type {
  BatchJobItemDto,
  BatchJobResult,
} from '../dtos/batch-generate.dto';
import { classifyMatchScore } from '../services/match-score-classifier.service';
import type { MatchScoreBlock } from '../interfaces/match-score-block.interface';

@Injectable()
export class BatchTailoringV2Service {
  private readonly logger = new Logger(BatchTailoringV2Service.name);

  constructor(
    @InjectQueue(BATCH_TAILORING_V2_QUEUE) private readonly queue: Queue,
    @InjectRepository(BatchTailoringRun)
    private readonly runRepo: Repository<BatchTailoringRun>,
    @InjectRepository(BatchTailoringJob)
    private readonly jobRepo: Repository<BatchTailoringJob>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}

  async enqueueBatch(args: {
    userContext: UserContext;
    jobs: BatchJobItemDto[];
    templateId: string;
    resumeId?: string;
  }): Promise<{ batchId: string; totalJobs: number }> {
    if (!args.jobs.length) {
      throw new BadRequestException(
        'At least one job is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }
    if (args.jobs.length > BATCH_V2_MAX_JOBS) {
      throw new BadRequestException(
        `Batch size exceeds limit of ${BATCH_V2_MAX_JOBS}`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const { batchId, jobRecords } = await this.dataSource.transaction(
      async (mgr) => {
        const run = mgr.create(BatchTailoringRun, {
          user_id: args.userContext.userId,
          template_id: args.templateId,
          resume_id: args.resumeId ?? null,
          total_jobs: args.jobs.length,
          status: 'queued',
        });
        const savedRun = await mgr.save(run);

        const records = args.jobs.map((j, idx) =>
          mgr.create(BatchTailoringJob, {
            batch_id: savedRun.id,
            job_index: idx,
            job_position: j.jobPosition,
            company_name: j.companyName,
            job_description: j.jobDescription,
            state: 'queued',
          }),
        );
        const savedJobs = await mgr.save(records);
        return { batchId: savedRun.id, jobRecords: savedJobs };
      },
    );

    const bulkJobs = jobRecords.map((record) => ({
      name: BATCH_TAILORING_V2_JOB_NAME,
      data: this.buildJobPayload(record, {
        totalJobs: args.jobs.length,
        templateId: args.templateId,
        resumeId: args.resumeId,
        userContext: args.userContext,
      }),
      opts: {
        // The processor's catch block persists failures and emits JOB_FAILED
        // synchronously, then returns cleanly (no re-throw). Bull therefore sees
        // jobs as succeeded and never retries — keep attempts: 1 to make the
        // configuration honest. If retry semantics are needed later, the
        // processor must classify errors and re-throw transient ones.
        attempts: 1,
        // Hard cap on a single job. The pipeline (LLM call + PDF + DB) should
        // finish in under 60s on a healthy system; 4 minutes is generous.
        // Without this Bull will wait indefinitely for a stalled handler,
        // leaving the batch run stuck and the SSE stream open forever.
        timeout: 240_000,
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 86400 },
      },
    }));

    try {
      await this.queue.addBulk(bulkJobs);
    } catch (enqueueError) {
      this.logger.error(
        `Failed to enqueue batch ${batchId} via addBulk, marking as failed`,
        enqueueError,
      );
      await this.jobRepo.update({ batch_id: batchId }, { state: 'failed' });
      await this.runRepo.update(
        { id: batchId },
        { status: 'failed', completed_at: new Date() },
      );
      throw enqueueError;
    }

    this.logger.log(
      `Enqueued batch ${batchId} with ${args.jobs.length} jobs for user ${args.userContext.userId}`,
    );
    return { batchId, totalJobs: args.jobs.length };
  }

  private buildJobPayload(
    record: BatchTailoringJob,
    args: {
      totalJobs: number;
      templateId: string;
      resumeId?: string;
      userContext: UserContext;
    },
  ): BatchJobPayloadV2 {
    return {
      batchId: record.batch_id,
      batchJobId: record.id,
      jobIndex: record.job_index,
      totalJobs: args.totalJobs,
      userId: args.userContext.userId,
      jobPosition: record.job_position,
      companyName: record.company_name,
      jobDescription: record.job_description,
      templateId: args.templateId,
      resumeId: args.resumeId,
      userContext: args.userContext,
    };
  }

  async getSnapshot(batchId: string, userId: string): Promise<SnapshotEvent> {
    const run = await this.runRepo.findOne({
      where: { id: batchId, user_id: userId },
    });
    if (!run) {
      throw new NotFoundException('Batch not found', ERROR_CODES.NOT_FOUND);
    }
    const jobs = await this.jobRepo.find({
      where: { batch_id: batchId },
      relations: ['resume_generation'],
      order: { job_index: 'ASC' },
    });

    // Resolve account fullName once so toResult can produce a stable, server-
    // generated filename identical to the one the live SSE job_completed event
    // emits. Without this, snapshot/replay paths return a result without
    // `filename`, forcing the client to regenerate and creating a divergence
    // between live vs. replayed downloads.
    const user = await this.userRepo.findOne({
      where: { id: run.user_id },
      select: ['full_name'],
    });
    const candidateName = user?.full_name ?? '';

    return {
      batchId: run.id,
      totalJobs: run.total_jobs,
      status: run.status,
      jobs: jobs.map((j) => ({
        index: j.job_index,
        jobPosition: j.job_position,
        companyName: j.company_name,
        state: j.state,
        result:
          j.state === 'completed' ? this.toResult(j, candidateName) : undefined,
        error: j.error_message ?? undefined,
      })),
    };
  }

  private toResult(
    job: BatchTailoringJob,
    candidateName: string,
  ): BatchJobResult {
    const rg = job.resume_generation;
    // Build the canonical block when both columns are populated. Otherwise
    // emit `null` — the legacy fallback (substituting changes_diff coverage
    // values) has been removed; absence is rendered explicitly on the FE.
    const matchScore: MatchScoreBlock | null =
      rg?.matchScoreBefore != null && rg?.matchScoreAfter != null
        ? classifyMatchScore(rg.matchScoreBefore, rg.matchScoreAfter)
        : null;
    return {
      jobPosition: job.job_position,
      companyName: job.company_name,
      status: 'success',
      resumeGenerationId: rg?.id,
      filename: generateResumeFilename(candidateName, job.job_position),
      keywordsAdded: rg?.keywords_added ?? 0,
      sectionsChanged: this.extractSectionsChanged(rg ?? null),
      matchScore,
      // TODO: remove after FE migration lands
      matchScoreBefore: rg?.matchScoreBefore ?? undefined,
      matchScoreAfter: rg?.matchScoreAfter ?? undefined,
    };
  }

  private extractSectionsChanged(rg: ResumeGeneration | null): number {
    if (!rg?.changes_diff) return 0;
    return (
      (rg.changes_diff as { sectionsChanged?: number }).sectionsChanged ?? 0
    );
  }
}
