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
      await this.transition(batchJobId, 'analyzing');
      // Bump run to 'processing' when the first job starts; condition prevents
      // redundant updates from concurrent workers on subsequent jobs.
      await this.runRepo.update(
        { id: batchId, status: 'queued' },
        { status: 'processing' },
      );
      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_STARTED, {
        batchId,
        // DB UUID is emitted alongside `jobIndex` (additive — both stay) so
        // the FE can match SSE updates to snapshot rows even when a retry
        // re-emits the same index. Retried jobs reuse the same row, so
        // `jobId` is naturally stable across attempts.
        jobId: batchJobId,
        jobIndex,
        stage: 'analyzing',
      });

      // Stage 2: optimizing
      await this.transition(batchJobId, 'optimizing');
      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_PROGRESS, {
        batchId,
        jobId: batchJobId,
        jobIndex,
        stage: 'optimizing',
      });

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
      await this.transition(batchJobId, 'finalizing');
      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_PROGRESS, {
        batchId,
        jobId: batchJobId,
        jobIndex,
        stage: 'finalizing',
      });

      // Persist completed state with the generation ID
      await this.jobRepo.update(
        { id: batchJobId },
        {
          state: 'completed',
          resume_generation_id: result.resumeGenerationId,
          completed_at: new Date(),
        },
      );
      await this.bumpRunCounters(batchId, { completed: 1 });

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

      // NOTE: `pdfContent` deliberately omitted from the SSE payload. Pushing
      // 100KB+ base64 over every SSE event is wasteful, fragile across proxies,
      // and creates a divergence between live events (which had it) and
      // snapshot/replay paths (which don't, because the DB only stores the
      // S3 key). Frontend downloads PDFs on demand via
      // `GET /resume-tailoring/download/:resumeGenerationId`.
      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_COMPLETED, {
        batchId,
        jobId: batchJobId,
        jobIndex,
        result: {
          jobPosition: job.data.jobPosition,
          companyName: job.data.companyName,
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
      });

      this.logger.log(
        `Batch v2 job ${batchJobId} (index ${jobIndex}) completed successfully`,
      );

      await this.maybeFinishBatch(batchId, startedAt);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      // Build the typed envelope BEFORE writing/emitting. The classifier
      // never throws — it returns `UNKNOWN` if it can't categorize — so this
      // path is safe to call unconditionally inside the catch block.
      const envelope = this.errorClassifier.classify(error);
      const envelopeJson = JSON.stringify(envelope);

      // Keep the raw cause loggable for ops without leaking it to the user-
      // facing envelope. `technicalDetail` is a short structured string
      // (e.g. `code=ERR_AI_OUTPUT_TRUNCATED inputCount=9 outputCount=4`).
      this.logger.error(
        `Batch v2 job ${batchJobId} (index ${jobIndex}) failed: ${message} | category=${envelope.category} technicalDetail=${envelope.technicalDetail}`,
        error instanceof Error ? error.stack : undefined,
      );

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
      await this.bumpRunCounters(batchId, { failed: 1 });

      await this.emit(batchId, BATCH_V2_SSE_EVENT_NAMES.JOB_FAILED, {
        batchId,
        // DB UUID is the stable cross-attempt identifier — the FE keys its
        // retry button off this value. `jobIndex` stays alongside for legacy
        // index-based matching.
        jobId: batchJobId,
        jobIndex,
        error: envelope,
      });

      await this.maybeFinishBatch(batchId, startedAt);
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
}
