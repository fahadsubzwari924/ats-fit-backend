import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BatchTailoringJob } from '../../../database/entities/batch-tailoring-job.entity';
import { BatchTailoringRun } from '../../../database/entities/batch-tailoring-run.entity';
import { BatchTailoringV2EventsGateway } from './batch-tailoring-v2.events.gateway';
import { ResumeGenerationOrchestratorService } from '../services/resume-generation-orchestrator.service';
import { BatchJobErrorClassifierService } from '../services/batch-job-error-classifier.service';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { FeatureType } from '../../../database/entities/usage-tracking.entity';
import type { UserContext as AuthUserContext } from '../../auth/types/user-context.type';
import {
  BATCH_TAILORING_V2_JOB_NAME,
  BATCH_TAILORING_V2_QUEUE,
  BATCH_V2_SSE_EVENT_NAMES,
  BATCH_V2_WORKER_CONCURRENCY,
} from './constants/batch-tailoring-v2.constants';
import type { BatchJobPayloadV2 } from './interfaces/batch-job-payload.interface';

/**
 * Batch Tailoring V2 Processor
 *
 * Consumes `process_batch_job` jobs from the `batch_tailoring_v2` Bull queue.
 * For each job it:
 *  1. Drives state transitions (analyzing → optimizing → finalizing → completed|failed)
 *  2. Calls the resume generation pipeline via ResumeGenerationOrchestratorService
 *  3. Persists results atomically to batch_tailoring_jobs / batch_tailoring_runs
 *  4. Emits SSE events at each stage via BatchTailoringV2EventsGateway
 *  5. Detects batch completion and emits a final batch_completed event
 *
 * Counter increments use raw SQL (UPDATE … SET col = col + N) to avoid
 * read-modify-write races when multiple workers run concurrently.
 *
 * Domain: Resume Tailoring — Batch V2
 * Queue: batch_tailoring_v2
 * Job type: process_batch_job
 */
@Processor(BATCH_TAILORING_V2_QUEUE)
export class BatchTailoringV2Processor {
  private readonly logger = new Logger(BatchTailoringV2Processor.name);

  /**
   * Build the canonical structured-log payload for a batch-job event so every
   * log line in this processor shares the same key set. Pass the job's
   * `data` payload so `userId`, `companyName`, `jobPosition` are always
   * present.
   */
  private buildLogContext(
    data: BatchJobPayloadV2,
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      userId: data.userId,
      batchId: data.batchId,
      batchJobId: data.batchJobId,
      jobIndex: data.jobIndex,
      companyName: data.companyName,
      jobPosition: data.jobPosition,
      ...extra,
    };
  }

  private logProcessorError(
    event: string,
    data: BatchJobPayloadV2,
    error: unknown,
    extra: Record<string, unknown> = {},
  ): void {
    this.logger.error(
      JSON.stringify({
        event,
        ...this.buildLogContext(data, extra),
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorMessage:
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : JSON.stringify(error),
      }),
      error instanceof Error ? error.stack : undefined,
    );
  }

  constructor(
    @InjectRepository(BatchTailoringJob)
    private readonly jobRepo: Repository<BatchTailoringJob>,
    @InjectRepository(BatchTailoringRun)
    private readonly runRepo: Repository<BatchTailoringRun>,
    private readonly orchestrator: ResumeGenerationOrchestratorService,
    private readonly events: BatchTailoringV2EventsGateway,
    private readonly rateLimitService: RateLimitService,
    private readonly errorClassifier: BatchJobErrorClassifierService,
  ) {}

  @Process({
    name: BATCH_TAILORING_V2_JOB_NAME,
    concurrency: BATCH_V2_WORKER_CONCURRENCY,
  })
  async handle(job: Job<BatchJobPayloadV2>): Promise<void> {
    const startedAt = Date.now();
    const { batchId, batchJobId, jobIndex } = job.data;

    this.logger.log(
      `Processing batch v2 job ${batchJobId} (index ${jobIndex}) for batch ${batchId}`,
    );

    try {
      // Stage 1: analyzing
      try {
        await this.transition(batchJobId, 'analyzing');
      } catch (transitionError) {
        this.logProcessorError(
          'batch_v2.transition_failed',
          job.data,
          transitionError,
          { fromStage: 'queued', toStage: 'analyzing' },
        );
        throw transitionError;
      }
      // Bump run to 'processing' when the first job starts; condition prevents
      // redundant updates from concurrent workers on subsequent jobs.
      try {
        await this.runRepo.update(
          { id: batchId, status: 'queued' },
          { status: 'processing' },
        );
      } catch (runUpdateError) {
        this.logProcessorError(
          'batch_v2.run_status_update_failed',
          job.data,
          runUpdateError,
          { intendedStatus: 'processing' },
        );
        throw runUpdateError;
      }
      await this.safeEmit(
        batchId,
        BATCH_V2_SSE_EVENT_NAMES.JOB_STARTED,
        {
          batchId,
          // DB UUID is emitted alongside `jobIndex` (additive — both stay) so
          // the FE can match SSE updates to snapshot rows even when a retry
          // re-emits the same index. Retried jobs reuse the same row, so
          // `jobId` is naturally stable across attempts.
          jobId: batchJobId,
          jobIndex,
          stage: 'analyzing',
        },
        job.data,
      );

      // Stage 2: optimizing
      try {
        await this.transition(batchJobId, 'optimizing');
      } catch (transitionError) {
        this.logProcessorError(
          'batch_v2.transition_failed',
          job.data,
          transitionError,
          { fromStage: 'analyzing', toStage: 'optimizing' },
        );
        throw transitionError;
      }
      await this.safeEmit(
        batchId,
        BATCH_V2_SSE_EVENT_NAMES.JOB_PROGRESS,
        {
          batchId,
          jobId: batchJobId,
          jobIndex,
          stage: 'optimizing',
        },
        job.data,
      );

      // Run the resume generation pipeline
      const result = await this.orchestrator.generateOptimizedResume({
        jobDescription: job.data.jobDescription,
        jobPosition: job.data.jobPosition,
        companyName: job.data.companyName,
        templateId: job.data.templateId,
        resumeId: job.data.resumeId,
        userContext: job.data.userContext,
      });

      if (result.kind !== 'pdf') return;

      // Stage 3: finalizing
      try {
        await this.transition(batchJobId, 'finalizing');
      } catch (transitionError) {
        this.logProcessorError(
          'batch_v2.transition_failed',
          job.data,
          transitionError,
          { fromStage: 'optimizing', toStage: 'finalizing' },
        );
        throw transitionError;
      }
      await this.safeEmit(
        batchId,
        BATCH_V2_SSE_EVENT_NAMES.JOB_PROGRESS,
        {
          batchId,
          jobId: batchJobId,
          jobIndex,
          stage: 'finalizing',
        },
        job.data,
      );

      // Persist completed state with the generation ID
      try {
        await this.jobRepo.update(
          { id: batchJobId },
          {
            state: 'completed',
            resume_generation_id: result.resumeGenerationId,
            completed_at: new Date(),
          },
        );
      } catch (persistError) {
        this.logProcessorError(
          'batch_v2.complete_persist_failed',
          job.data,
          persistError,
          { resumeGenerationId: result.resumeGenerationId },
        );
        throw persistError;
      }

      try {
        await this.bumpRunCounters(batchId, { completed: 1 });
      } catch (bumpError) {
        this.logProcessorError(
          'batch_v2.bump_run_counters_failed',
          job.data,
          bumpError,
          { delta: { completed: 1 } },
        );
        throw bumpError;
      }

      // Shared-pool: each successful resume in a batch consumes 1 unit of the
      // monthly RESUME_GENERATION pool (same pool that single tailorings draw
      // from). Failed jobs do NOT consume quota — this code only runs in the
      // success path. Errors here are logged but do not fail the job; the user
      // already received their resume.
      try {
        await this.rateLimitService.recordUsage(
          job.data.userContext as unknown as AuthUserContext,
          FeatureType.RESUME_GENERATION,
        );
      } catch (recordError) {
        this.logger.error(
          `Failed to record RESUME_GENERATION usage for batch job ${batchJobId}`,
          recordError instanceof Error ? recordError.stack : recordError,
        );
      }

      // Auto-tracking of the job_application happens inside
      // `ResumeGenerationOrchestratorService.runTailoringPipeline` — single
      // source of truth covering both single and batch flows. Do NOT add a
      // tracker call here; it would double-fire (idempotent but noisy).

      // NOTE: `pdfContent` deliberately omitted from the SSE payload. Pushing
      // 100KB+ base64 over every SSE event is wasteful, fragile across proxies,
      // and creates a divergence between live events (which had it) and
      // snapshot/replay paths (which don't, because the DB only stores the
      // S3 key). Frontend downloads PDFs on demand via
      // `GET /resume-tailoring/download/:resumeGenerationId`.
      await this.safeEmit(
        batchId,
        BATCH_V2_SSE_EVENT_NAMES.JOB_COMPLETED,
        {
          batchId,
          jobId: batchJobId,
          jobIndex,
          result: {
            jobPosition: job.data.jobPosition,
            companyName: job.data.companyName,
            jobDescription: job.data.jobDescription,
            status: 'success',
            resumeGenerationId: result.resumeGenerationId,
            filename: result.filename,
            optimizationConfidence: result.optimizationConfidence,
            keywordsAdded: result.keywordsAdded,
            sectionsChanged: result.sectionsChanged,
            // Canonical MatchScoreBlock — what the FE consumes going forward.
            matchScore: result.matchScore,
            // TODO: remove after FE migration lands
            matchScoreBefore: result.matchScoreBefore,
            matchScoreAfter: result.matchScoreAfter,
          },
        },
        job.data,
      );

      this.logger.log(
        `Batch v2 job ${batchJobId} (index ${jobIndex}) completed successfully`,
      );

      try {
        await this.maybeFinishBatch(batchId, startedAt);
      } catch (finishError) {
        this.logProcessorError(
          'batch_v2.maybe_finish_failed',
          job.data,
          finishError,
        );
      }
    } catch (error) {
      // Build the typed envelope BEFORE writing/emitting. The classifier
      // never throws — it returns `UNKNOWN` if it can't categorize — so this
      // path is safe to call unconditionally inside the catch block.
      const envelope = this.errorClassifier.classify(error);
      const envelopeJson = JSON.stringify(envelope);

      // Keep the raw cause loggable for ops without leaking it to the user-
      // facing envelope. `technicalDetail` is a short structured string
      // (e.g. `code=ERR_AI_OUTPUT_TRUNCATED inputCount=9 outputCount=4`).
      this.logger.error(
        JSON.stringify({
          event: 'batch_v2.job_failed',
          ...this.buildLogContext(job.data, {
            category: envelope.category,
            technicalDetail: envelope.technicalDetail,
            durationMs: Date.now() - startedAt,
          }),
          errorName: error instanceof Error ? error.name : 'Unknown',
          errorMessage: error instanceof Error ? error.message : String(error),
        }),
        error instanceof Error ? error.stack : undefined,
      );

      try {
        await this.jobRepo.update(
          { id: batchJobId },
          {
            state: 'failed',
            // The column stays `text` — we JSON-encode the envelope so legacy
            // plain-string rows and new JSON rows coexist without a migration.
            // The service-layer mapper detects shape at read time.
            error_message: envelopeJson,
            completed_at: new Date(),
          },
        );
      } catch (failurePersistError) {
        // Secondary write — original failure already logged above. Log the
        // secondary so we know the row was never marked failed; otherwise
        // the batch will appear stuck in 'optimizing' forever.
        this.logProcessorError(
          'batch_v2.failure_persist_failed',
          job.data,
          failurePersistError,
          { originalCategory: envelope.category },
        );
      }

      try {
        await this.bumpRunCounters(batchId, { failed: 1 });
      } catch (bumpError) {
        this.logProcessorError(
          'batch_v2.bump_run_counters_failed',
          job.data,
          bumpError,
          { delta: { failed: 1 } },
        );
      }

      await this.safeEmit(
        batchId,
        BATCH_V2_SSE_EVENT_NAMES.JOB_FAILED,
        {
          batchId,
          // DB UUID is the stable cross-attempt identifier — the FE keys its
          // retry button off this value. `jobIndex` stays alongside for legacy
          // index-based matching.
          jobId: batchJobId,
          jobIndex,
          error: envelope,
        },
        job.data,
      );

      try {
        await this.maybeFinishBatch(batchId, startedAt);
      } catch (finishError) {
        this.logProcessorError(
          'batch_v2.maybe_finish_failed',
          job.data,
          finishError,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Atomically transition a BatchTailoringJob to the given state.
   * Sets started_at on the first transition ('analyzing').
   */
  private async transition(
    batchJobId: string,
    state: 'analyzing' | 'optimizing' | 'finalizing',
  ): Promise<void> {
    const patch: Partial<BatchTailoringJob> = { state };
    if (state === 'analyzing') {
      patch.started_at = new Date();
    }
    await this.jobRepo.update({ id: batchJobId }, patch);
  }

  /**
   * Atomically increment run-level counters using a raw SQL UPDATE so that
   * concurrent workers never produce a read-modify-write race.
   */
  private async bumpRunCounters(
    batchId: string,
    delta: { completed?: number; failed?: number },
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [batchId];

    if (delta.completed) {
      params.push(delta.completed);
      sets.push(`completed_jobs = completed_jobs + $${params.length}`);
    }
    if (delta.failed) {
      params.push(delta.failed);
      sets.push(`failed_jobs = failed_jobs + $${params.length}`);
    }
    if (!sets.length) return;

    await this.runRepo.query(
      `UPDATE batch_tailoring_runs SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
  }

  /**
   * Check whether all jobs in the batch are done.
   * If so, compute the final status, persist it, and emit batch_completed.
   *
   * Uses an atomic UPDATE … RETURNING so that only the worker that flips the
   * row from a non-terminal status to a terminal one proceeds to emit the
   * batch_completed event. Any racing workers receive an empty result set
   * (because the WHERE clause no longer matches) and silently return.
   */
  private async maybeFinishBatch(
    batchId: string,
    startedAt: number,
  ): Promise<void> {
    // Atomic transition: only the worker that flips the row from non-terminal to terminal proceeds
    const result: Array<{
      total_jobs: number;
      completed_jobs: number;
      failed_jobs: number;
    }> = await this.runRepo.query(
      `UPDATE batch_tailoring_runs
          SET status = CASE
                WHEN failed_jobs = 0 THEN 'completed'
                WHEN completed_jobs = 0 THEN 'failed'
                ELSE 'partial'
              END,
              completed_at = NOW()
        WHERE id = $1
          AND status NOT IN ('completed', 'partial', 'failed')
          AND completed_jobs + failed_jobs >= total_jobs
        RETURNING total_jobs, completed_jobs, failed_jobs`,
      [batchId],
    );

    const row = result[0];
    if (!row) return; // Either already finished, or not yet ready

    await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.BATCH_COMPLETED, {
      batchId,
      summary: {
        total: row.total_jobs,
        succeeded: row.completed_jobs,
        failed: row.failed_jobs,
        totalProcessingTimeMs: Date.now() - startedAt,
      },
    });
  }

  /**
   * Atomically increment last_event_id via RETURNING and publish the envelope
   * to the SSE gateway. Using a raw SQL UPDATE … RETURNING ensures monotonic,
   * gap-free event IDs even under concurrent workers.
   */
  private async emit(
    batchId: string,
    eventName: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const rows: Array<{ last_event_id: number }> = await this.runRepo.query(
      `UPDATE batch_tailoring_runs SET last_event_id = last_event_id + 1 WHERE id = $1 RETURNING last_event_id`,
      [batchId],
    );
    const eventId = rows[0]?.last_event_id ?? 0;
    this.events.publish({ batchId, eventName, data, eventId });
  }

  /**
   * Emit an SSE event without ever failing the worker. SSE delivery is
   * advisory — the snapshot endpoint is the source of truth for replay — so a
   * transient publish/event-id-update failure must not poison the batch.
   */
  private async safeEmit(
    batchId: string,
    eventName: string,
    data: Record<string, unknown>,
    jobData: BatchJobPayloadV2,
  ): Promise<void> {
    try {
      await this.emit(batchId, eventName, data);
    } catch (emitError) {
      this.logProcessorError(
        'batch_v2.sse_publish_failed',
        jobData,
        emitError,
        { sseEvent: eventName },
      );
    }
  }
}
