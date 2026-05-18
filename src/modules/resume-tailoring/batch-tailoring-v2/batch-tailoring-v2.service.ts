import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JobRelevanceService } from '../../job-relevance/job-relevance.service';
import { JobRelevanceVerdict } from '../../job-relevance/enums/job-relevance-verdict.enum';
import type { JobRelevanceResult } from '../../job-relevance/interfaces/job-relevance.interface';
import type { JobRelevanceProfileSource } from '../../job-relevance/interfaces/job-relevance-input.interface';
import { ResumeProfileEnrichmentService } from '../services/resume-profile-enrichment.service';
import { Queue } from 'bull';
import { DataSource, Repository } from 'typeorm';
import { BatchTailoringRun } from '../../../database/entities/batch-tailoring-run.entity';
import { BatchTailoringJob } from '../../../database/entities/batch-tailoring-job.entity';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { User, UserPlan } from '../../../database/entities/user.entity';
import {
  BadRequestException,
  CustomHttpException,
  ForbiddenException,
  NotFoundException,
  TooManyRequestsException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { HttpStatus } from '@nestjs/common';
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
import type {
  BatchJobError,
  BatchJobErrorCategory,
} from '../interfaces/batch-job-error.interface';
import type { BatchJobRetryResponseDto } from '../dtos/batch-job-retry.dto';

/**
 * Hard cap on the number of times a single batch job may be manually retried
 * via the per-job retry endpoint. The check is `retry_count >= MAX_MANUAL_RETRIES`;
 * the column is incremented BEFORE re-enqueueing, so the user gets exactly
 * MAX_MANUAL_RETRIES retry attempts in total. Two is a deliberate floor — one
 * is too restrictive when transient AI overload hits, three opens the door to
 * FE-driven spam loops.
 */
const MAX_MANUAL_RETRIES = 2;

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
    private readonly jobRelevanceService: JobRelevanceService,
    private readonly resumeProfileEnrichmentService: ResumeProfileEnrichmentService,
  ) {}

  async enqueueBatch(args: {
    userContext: UserContext;
    jobs: BatchJobItemDto[];
    templateId: string;
    resumeId?: string;
    acknowledgeLowFit?: boolean;
  }): Promise<
    | { kind: 'enqueued'; batchId: string; totalJobs: number }
    | {
        kind: 'low_fit_warning';
        jobs: Array<{ jobIndex: number; relevance: JobRelevanceResult }>;
      }
  > {
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

    if (!args.acknowledgeLowFit) {
      const relevances = await this.runPreflightRelevance(
        args.userContext.userId,
        args.jobs,
      );
      const hasLowFit = relevances.some(
        (r) => r.verdict === JobRelevanceVerdict.LOW,
      );
      if (hasLowFit) {
        return {
          kind: 'low_fit_warning',
          jobs: relevances.map((relevance, jobIndex) => ({
            jobIndex,
            relevance,
          })),
        };
      }
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
    return { kind: 'enqueued', batchId, totalJobs: args.jobs.length };
  }

  private async resolveRelevanceProfile(
    userId: string,
  ): Promise<JobRelevanceProfileSource> {
    const enriched =
      await this.resumeProfileEnrichmentService.getProfileForUser(userId);
    if (enriched) {
      return {
        kind: 'enriched',
        profileVersion: enriched.version,
        content: enriched.enrichedContent,
      };
    }
    return { kind: 'none' };
  }

  private async runPreflightRelevance(
    userId: string,
    jobs: BatchJobItemDto[],
  ): Promise<JobRelevanceResult[]> {
    const profile = await this.resolveRelevanceProfile(userId);
    return Promise.all(
      jobs.map((job) =>
        this.jobRelevanceService.score({
          userId,
          profile,
          jobPosition: job.jobPosition,
          companyName: job.companyName,
          jobDescription: job.jobDescription,
        }),
      ),
    );
  }

  /**
   * Retry a single failed job in place — does NOT re-run the rest of the batch
   * and does NOT decrement quota (quota was paid at original batch enqueue).
   *
   * Guard order (all required, all non-skippable):
   *   1. Batch exists                                      → 404 ERR_NOT_FOUND
   *   2. Batch belongs to caller (ownership)               → 403 ERR_FORBIDDEN
   *   3. Job exists and belongs to that batch              → 404 ERR_NOT_FOUND
   *   4. Job is in `failed` state                          → 409 ERR_JOB_NOT_RETRYABLE
   *   5. Job has not exceeded the manual retry cap         → 429 ERR_RETRY_LIMIT_EXCEEDED
   *
   * Resets the row's per-attempt fields (error_message, started_at,
   * completed_at, resume_generation_id) and bumps `retry_count`. We DO NOT
   * decrement `failed_jobs` on the parent run here — if the retry succeeds
   * the processor's success path will bump `completed_jobs` (so the run will
   * read e.g. completed=3, failed=1, total=3). Surfacing that arithmetic
   * correctly is a FE concern; the BE-side counters remain monotonic event
   * counts, not "currently-failed" gauges.
   *
   * Re-enqueues via the same Bull queue + job name the original enqueue path
   * uses, which routes back through `BatchTailoringV2Processor.handle()` —
   * no orchestration duplicated.
   */
  async retryFailedJob(
    batchId: string,
    jobId: string,
    userId: string,
  ): Promise<BatchJobRetryResponseDto> {
    // 1. Load batch — 404 if not found
    const batch = await this.runRepo.findOne({ where: { id: batchId } });
    if (!batch) {
      throw new NotFoundException('Batch not found', ERROR_CODES.NOT_FOUND);
    }

    // 2. Ownership check — 403 if the batch belongs to a different user.
    //    Non-negotiable: cross-user access MUST 403. We deliberately return a
    //    different status from 404 here so we don't leak existence of the
    //    batch to a non-owner — that's a deliberate trade because the
    //    `:batchId` is itself unguessable (UUIDv4).
    if (batch.user_id !== userId) {
      throw new ForbiddenException(
        'You do not have permission to retry this job',
        ERROR_CODES.FORBIDDEN,
      );
    }

    // 3. Load the job scoped to the batch — 404 otherwise
    const jobRecord = await this.jobRepo.findOne({
      where: { id: jobId, batch_id: batchId },
    });
    if (!jobRecord) {
      throw new NotFoundException('Job not found', ERROR_CODES.NOT_FOUND);
    }

    // 4. Only `failed` rows are retryable. `queued`/`analyzing`/`optimizing`/
    //    `finalizing` are in-flight — letting the user retry would double-
    //    process. `completed` is already done. 409 is the right shape here.
    if (jobRecord.state !== 'failed') {
      throw new CustomHttpException(
        {
          message: 'Job is not in a retryable state',
          errorCode: ERROR_CODES.JOB_NOT_RETRYABLE,
        },
        HttpStatus.CONFLICT,
      );
    }

    // 5. Hard cap — prevent FE-driven retry loops. The cap is enforced on the
    //    pre-increment value so the user gets exactly MAX_MANUAL_RETRIES
    //    attempts in total before the endpoint locks out.
    if (jobRecord.retry_count >= MAX_MANUAL_RETRIES) {
      throw new TooManyRequestsException(
        'You have reached the retry limit for this resume',
        ERROR_CODES.RETRY_LIMIT_EXCEEDED,
      );
    }

    // Reset per-attempt fields and bump retry_count. We clear the previous
    // error envelope, generation reference, and timing columns so the
    // processor's success-path writes land cleanly. Reset to `queued` matches
    // the row state the processor expects when picking up a Bull job.
    const nextRetryCount = jobRecord.retry_count + 1;
    await this.jobRepo.update(
      { id: jobId },
      {
        state: 'queued',
        error_message: null,
        started_at: null,
        completed_at: null,
        resume_generation_id: null,
        retry_count: nextRetryCount,
      },
    );

    // Reload the run+job ids needed to construct the canonical processor
    // payload. We deliberately do NOT trust the in-memory `jobRecord` for
    // these — TypeORM `update()` does not refresh local entity state and we
    // want the payload to match exactly what the original enqueue produced.
    const refreshedJob = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!refreshedJob) {
      // Extremely defensive — between the update above and this read the row
      // was deleted. Treat as 404 so the FE shows a sensible message.
      throw new NotFoundException('Job not found', ERROR_CODES.NOT_FOUND);
    }

    // Re-enqueue via the same Bull queue + job name the original enqueue
    // uses. The processor picks the job up, runs the same handle() entry, and
    // emits the standard `job_started → job_progress → job_completed |
    // job_failed` SSE sequence — no first-attempt-only guards anywhere.
    //
    // Quota is NOT consumed here. The original batch enqueue performed the
    // shared-pool pre-check; the processor's success path records usage. On
    // retry, we re-run the same success path which records a second usage
    // unit ONLY if the retry now succeeds — that's intentional, because the
    // first attempt's failure did NOT consume quota.
    //
    // userContext is reconstructed from `userId` because the original
    // queue.add wrapped a snapshot of the userContext into the payload. We
    // build a minimal-but-sufficient snapshot here — the processor only uses
    // `userId`/plan tier for quota tracking, both of which are stable across
    // retries.
    const payload: BatchJobPayloadV2 = {
      batchId: refreshedJob.batch_id,
      batchJobId: refreshedJob.id,
      jobIndex: refreshedJob.job_index,
      totalJobs: batch.total_jobs,
      userId,
      jobPosition: refreshedJob.job_position,
      companyName: refreshedJob.company_name,
      jobDescription: refreshedJob.job_description,
      templateId: batch.template_id ?? '',
      resumeId: batch.resume_id ?? undefined,
      userContext: await this.buildRetryUserContext(userId),
    };

    await this.queue.add(BATCH_TAILORING_V2_JOB_NAME, payload, {
      // Match the original enqueue options exactly so retry behavior is
      // indistinguishable from a first attempt at the Bull layer. attempts=1
      // prevents Bull-level retry on top of our manual retry — the FE owns
      // retry UX, not the queue.
      attempts: 1,
      timeout: 240_000,
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 86400 },
    });

    this.logger.log(
      `Retry enqueued for batch ${batchId} job ${jobId} (retry_count=${nextRetryCount}) by user ${userId}`,
    );

    return {
      ok: true,
      jobId,
      retryCount: nextRetryCount,
    };
  }

  /**
   * Build the minimal UserContext needed to re-process a retry job.
   *
   * The processor consumes `userContext` for: (a) quota recording in the
   * success path via `RateLimitService.recordUsage`, and (b) downstream
   * generation orchestrator calls that branch on plan tier. Reconstructing
   * from the User row preserves correctness across retries even if the
   * caller's session has refreshed since the original batch.
   */
  private async buildRetryUserContext(userId: string): Promise<UserContext> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'user_type', 'plan'],
    });
    if (!user) {
      // The batch ownership check above already guaranteed the user exists at
      // the time of the request, but be defensive — if the row was deleted
      // mid-flight, fail loudly rather than silently passing a malformed
      // userContext to the processor.
      throw new NotFoundException('User not found', ERROR_CODES.USER_NOT_FOUND);
    }
    const isPremium = user.plan === UserPlan.PREMIUM;
    return {
      userId: user.id,
      userType: user.user_type,
      plan: isPremium ? 'premium' : 'freemium',
      isPremium,
    };
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
        // DB UUID — what the FE uses as the `jobId` query parameter when
        // calling the retry endpoint. Must literally be the row id (no
        // synthesis), so retried events match snapshot rows.
        id: j.id,
        index: j.job_index,
        jobPosition: j.job_position,
        companyName: j.company_name,
        state: j.state,
        // Manual-retry counter (Task E). The FE hides the retry button once
        // this reaches MAX_MANUAL_RETRIES (2).
        retryCount: j.retry_count,
        result:
          j.state === 'completed' ? this.toResult(j, candidateName) : undefined,
        error: this.parseErrorEnvelope(j.error_message, j.completed_at),
      })),
    };
  }

  /**
   * Read-time shape detection for `batch_tailoring_jobs.error_message`.
   *
   * Three input shapes, one output shape:
   * 1. `null` / empty → return `undefined` (job hasn't failed, or the column
   *    has no payload).
   * 2. JSON-encoded `BatchJobError` envelope (post-Task-D rows) → parse and
   *    return as-is, defensively shape-checking the `category` field.
   * 3. Plain-string legacy rows (pre-Task-D failures) → synthesize an
   *    `UNKNOWN/retryable: true` envelope so the FE renders the legacy
   *    string as the userMessage with a retry button.
   *
   * Migration-free: the DB column stays `text`, both shapes coexist forever.
   */
  private parseErrorEnvelope(
    rawErrorMessage: string | null,
    completedAt: Date | null,
  ): BatchJobError | undefined {
    if (!rawErrorMessage) return undefined;
    const trimmed = rawErrorMessage.trim();
    if (!trimmed) return undefined;

    // Shape 2 — JSON envelope. Only try to parse when the payload begins
    // with `{`; otherwise we'd waste a try/catch on every legacy row.
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed) as Partial<BatchJobError> | null;
        if (
          parsed &&
          typeof parsed === 'object' &&
          typeof parsed.category === 'string' &&
          this.isValidCategory(parsed.category)
        ) {
          return {
            category: parsed.category,
            userMessage:
              typeof parsed.userMessage === 'string' ? parsed.userMessage : '',
            technicalDetail:
              typeof parsed.technicalDetail === 'string'
                ? parsed.technicalDetail
                : '',
            retryable:
              typeof parsed.retryable === 'boolean' ? parsed.retryable : true,
            occurredAt:
              typeof parsed.occurredAt === 'string' ? parsed.occurredAt : '',
          };
        }
        // JSON parsed but shape didn't match — fall through to legacy synth
      } catch {
        // Not valid JSON despite the leading `{` — fall through to legacy synth
      }
    }

    // Shape 3 — legacy plain-string row. Synthesize a retryable UNKNOWN
    // envelope so the FE renders consistently. `occurredAt` falls back to
    // the job's completed_at when present (which it should be for any row
    // that actually failed).
    return {
      category: 'UNKNOWN',
      userMessage: trimmed,
      technicalDetail: 'legacy-format',
      retryable: true,
      occurredAt: completedAt ? completedAt.toISOString() : '',
    };
  }

  private isValidCategory(value: string): value is BatchJobErrorCategory {
    return (
      value === 'AI_TRUNCATION' ||
      value === 'AI_OVERLOAD' ||
      value === 'AI_PARSING' ||
      value === 'NETWORK' ||
      value === 'UNKNOWN'
    );
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
      jobDescription: job.job_description,
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
