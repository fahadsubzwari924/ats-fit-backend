import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Observable, Subject, concat, interval, merge, of } from 'rxjs';
import { map, takeUntil, tap } from 'rxjs/operators';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { PremiumUserGuard } from '../../auth/guards/premium-user.guard';
import { RateLimitFeature } from '../../rate-limit/rate-limit.guard';
import { RateLimitService } from '../../rate-limit/rate-limit.service';
import { UsageTrackingInterceptor } from '../../rate-limit/usage-tracking.interceptor';
import { FeatureType } from '../../../database/entities/usage-tracking.entity';
import { TransformUserContext } from '../../../shared/decorators/transform-user-context.decorator';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import { BatchTailoringV2Service } from './batch-tailoring-v2.service';
import { BatchTailoringV2EventsGateway } from './batch-tailoring-v2.events.gateway';
import {
  EnqueueBatchV2Dto,
  EnqueueBatchV2ResponseDto,
} from './dto/enqueue-batch-v2.dto';
import { BatchSnapshotV2Dto } from './dto/batch-status-v2.dto';
import { BatchJobRetryResponseDto } from '../dtos/batch-job-retry.dto';
import { BadRequestException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import {
  BATCH_V2_HEARTBEAT_MS,
  BATCH_V2_SSE_EVENT_NAMES,
} from './constants/batch-tailoring-v2.constants';
import type { SnapshotEvent } from './interfaces/batch-sse-event.interface';
import type { UserContext } from '../interfaces/user-context.interface';

@ApiTags('Resume Tailoring (Batch v2)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('resume-tailoring/batch/v2')
export class BatchTailoringV2Controller {
  constructor(
    private readonly batchService: BatchTailoringV2Service,
    private readonly events: BatchTailoringV2EventsGateway,
    private readonly rateLimitService: RateLimitService,
  ) {}

  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  @TransformUserContext()
  @UseGuards(PremiumUserGuard)
  @RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)
  @UseInterceptors(UsageTrackingInterceptor)
  @ApiOperation({ summary: 'Enqueue a batch tailoring run (1–3 jobs, async)' })
  @ApiResponse({ status: 202, type: EnqueueBatchV2ResponseDto })
  async enqueue(
    @Body() dto: EnqueueBatchV2Dto,
    @Req() req: RequestWithUserContext,
  ): Promise<EnqueueBatchV2ResponseDto> {
    const userId = req.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    // Shared-pool pre-check: every resume in the batch will draw from the
    // same monthly RESUME_GENERATION pool as single tailorings. Reject before
    // enqueueing if this batch would push the user over their tailored-resume
    // limit. The processor increments RESUME_GENERATION per successful resume
    // (failed jobs do not consume quota).
    const tailoredResumeUsage = await this.rateLimitService.checkRateLimit(
      req.userContext,
      FeatureType.RESUME_GENERATION,
    );
    if (
      tailoredResumeUsage.currentUsage + dto.jobs.length >
      tailoredResumeUsage.limit
    ) {
      throw new ForbiddenException({
        message: `This batch would exceed your monthly tailored-resume limit. ${tailoredResumeUsage.remaining} of ${tailoredResumeUsage.limit} remaining; you requested ${dto.jobs.length}.`,
        errorCode: ERROR_CODES.RATE_LIMIT_EXCEEDED,
        feature: FeatureType.RESUME_GENERATION,
        currentUsage: tailoredResumeUsage.currentUsage,
        limit: tailoredResumeUsage.limit,
        remaining: tailoredResumeUsage.remaining,
        resetDate: tailoredResumeUsage.resetDate,
      });
    }

    return this.batchService.enqueueBatch({
      userContext: req.userContext as UserContext,
      jobs: dto.jobs,
      templateId: dto.templateId,
      resumeId: dto.resumeId,
    });
  }

  @Sse(':batchId/events')
  @TransformUserContext()
  @ApiOperation({ summary: 'SSE stream of batch processing events' })
  async stream(
    @Param('batchId') batchId: string,
    @Req() req: RequestWithUserContext,
  ): Promise<Observable<MessageEvent>> {
    const userId = req.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    const snapshot: SnapshotEvent = await this.batchService.getSnapshot(
      batchId,
      userId,
    );

    // If batch already reached a terminal state, send the snapshot and close —
    // the batch_completed event was emitted before this client subscribed, so
    // done$ would never fire and the heartbeat would run forever without this.
    const terminalStatuses = ['completed', 'partial', 'failed'] as const;
    if (
      terminalStatuses.includes(
        snapshot.status as (typeof terminalStatuses)[number],
      )
    ) {
      return of({
        type: BATCH_V2_SSE_EVENT_NAMES.SNAPSHOT,
        data: JSON.stringify(snapshot),
        id: '0',
      } as unknown as MessageEvent);
    }

    const done$ = new Subject<void>();

    const initial$: Observable<MessageEvent> = of({
      type: BATCH_V2_SSE_EVENT_NAMES.SNAPSHOT,
      data: JSON.stringify(snapshot),
      id: '0',
    });

    const live$: Observable<MessageEvent> = this.events.forBatch(batchId).pipe(
      map(
        (env) =>
          ({
            type: env.eventName,
            data: JSON.stringify(env.data),
            id: String(env.eventId),
          }) satisfies MessageEvent,
      ),
      tap((msg) => {
        if (msg.type === BATCH_V2_SSE_EVENT_NAMES.BATCH_COMPLETED) {
          done$.next();
          done$.complete();
        }
      }),
      takeUntil(done$),
    );

    const heartbeat$: Observable<MessageEvent> = interval(
      BATCH_V2_HEARTBEAT_MS,
    ).pipe(
      takeUntil(done$),
      map(() => ({
        type: BATCH_V2_SSE_EVENT_NAMES.HEARTBEAT,
        data: JSON.stringify({ ts: Date.now() }),
      })),
    );

    return merge(concat(initial$, live$), heartbeat$);
  }

  @Get(':batchId/status')
  @TransformUserContext()
  @ApiOperation({
    summary: 'Polling fallback — returns current batch snapshot',
  })
  @ApiResponse({ status: 200, type: BatchSnapshotV2Dto })
  async status(
    @Param('batchId') batchId: string,
    @Req() req: RequestWithUserContext,
  ): Promise<SnapshotEvent> {
    const userId = req.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }
    return this.batchService.getSnapshot(batchId, userId);
  }

  /**
   * Per-job manual retry endpoint (Task E).
   *
   * Retries a single failed job in place without re-running the whole batch
   * and WITHOUT decrementing quota (the batch enqueue already pre-checked
   * quota, and the processor only records usage on success). The retried job
   * runs through the same processor entry as the original attempt — the SSE
   * channel for `:batchId` will deliver standard
   * `job_started → job_progress → job_completed | job_failed` events for the
   * retried job; the FE updates the row in place from those events.
   *
   * Auth: mirrors the other endpoints in this controller — the class-level
   * `@UseGuards(JwtAuthGuard)` enforces a valid JWT, and
   * `@TransformUserContext()` populates `req.userContext` so we can extract
   * `userId` and pass it to the service for the ownership check.
   *
   * Status codes:
   *   200 — retry enqueued, body = `{ ok: true, jobId, retryCount }`
   *   400 — caller has no userContext (shouldn't happen post-guard)
   *   403 — caller does not own the batch
   *   404 — batch or job not found
   *   409 — job state !== 'failed'  (ERR_JOB_NOT_RETRYABLE)
   *   429 — retry_count >= 2        (ERR_RETRY_LIMIT_EXCEEDED)
   */
  @Post(':batchId/jobs/:jobId/retry')
  @TransformUserContext()
  @ApiOperation({
    summary: 'Retry a single failed batch job (quota-free, in-place)',
  })
  @ApiResponse({ status: 200, type: BatchJobRetryResponseDto })
  @HttpCode(HttpStatus.OK)
  async retryJob(
    @Param('batchId') batchId: string,
    @Param('jobId') jobId: string,
    @Req() req: RequestWithUserContext,
  ): Promise<BatchJobRetryResponseDto> {
    const userId = req.userContext?.userId;
    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }
    return this.batchService.retryFailedJob(batchId, jobId, userId);
  }
}
