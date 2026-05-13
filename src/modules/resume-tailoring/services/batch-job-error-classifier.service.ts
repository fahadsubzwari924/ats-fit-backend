import { Injectable, Logger } from '@nestjs/common';
import {
  BadRequestException,
  CustomHttpException,
  ForbiddenException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import type {
  BatchJobError,
  BatchJobErrorCategory,
} from '../interfaces/batch-job-error.interface';

/**
 * Headline + subline copy locked by the plan's "Canonical error envelope"
 * table. Single source of truth for what the FE renders — do NOT edit
 * without updating the plan and the FE rendering layer together.
 */
const CATEGORY_COPY: Record<
  BatchJobErrorCategory,
  { headline: string; subline: string }
> = {
  AI_TRUNCATION: {
    headline: 'This resume needs a longer answer than the AI returned.',
    subline:
      "We'll try again with more room. Tap retry to give it another shot.",
  },
  AI_OVERLOAD: {
    headline: 'The AI service was busy. We backed off to be polite.',
    subline: 'Tap retry — capacity usually recovers within a few seconds.',
  },
  AI_PARSING: {
    headline: "The AI returned a response we couldn't read cleanly.",
    subline: 'This is rare. Retry usually succeeds on the second pass.',
  },
  NETWORK: {
    headline: "We couldn't reach the AI service.",
    subline: 'Check your connection and tap retry, or try again in a moment.',
  },
  UNKNOWN: {
    headline: 'Something unexpected happened generating this resume.',
    subline: "Tap retry. If this keeps happening, let us know — we'll dig in.",
  },
};

/**
 * Map a thrown error from the batch tailoring pipeline into a typed
 * `BatchJobError` envelope. The envelope is JSON-encoded into
 * `batch_tailoring_jobs.error_message` by the processor, and the same shape
 * flows out through the API/SSE layer to the FE.
 *
 * Contract: `classify` MUST NOT throw. If pattern-matching fails or the
 * input shape is unexpected, return an `UNKNOWN` envelope. Failures inside
 * error-handling code are how we get blank screens, so the classifier is
 * intentionally defensive.
 */
@Injectable()
export class BatchJobErrorClassifierService {
  private readonly logger = new Logger(BatchJobErrorClassifierService.name);

  classify(error: unknown): BatchJobError {
    try {
      return this.classifyInternal(error);
    } catch (classifierError) {
      // Defensive net — the classifier itself must never propagate an error,
      // otherwise the processor's catch block becomes a black hole.
      this.logger.error(
        'BatchJobErrorClassifier threw while classifying — defaulting to UNKNOWN',
        classifierError instanceof Error
          ? classifierError.stack
          : classifierError,
      );
      return this.buildEnvelope('UNKNOWN', 'classifier-internal-error', true);
    }
  }

  private classifyInternal(error: unknown): BatchJobError {
    // 1. Custom HTTP exceptions thrown by our own services — match by errorCode
    if (error instanceof CustomHttpException) {
      const response = error.getResponse() as {
        errorCode?: unknown;
        details?: unknown;
      };
      const code =
        typeof response?.errorCode === 'string' ? response.errorCode : '';

      if (code === ERROR_CODES.AI_OUTPUT_TRUNCATED) {
        return this.buildEnvelope(
          'AI_TRUNCATION',
          this.buildTruncationDetail(code, response?.details),
          true,
        );
      }

      if (code === ERROR_CODES.AI_RESPONSE_PARSING_FAILED) {
        return this.buildEnvelope('AI_PARSING', `code=${code}`, true);
      }

      // BadRequest / Forbidden are NOT retryable — user input or quota is the
      // problem and a retry can't fix it. Keep userMessage generic-UNKNOWN
      // because BadRequest messages from deep services aren't always safe to
      // render verbatim.
      if (error instanceof BadRequestException) {
        return this.buildEnvelope(
          'UNKNOWN',
          `code=${code || 'ERR_BAD_REQUEST'}`,
          false,
        );
      }
      if (error instanceof ForbiddenException) {
        return this.buildEnvelope(
          'UNKNOWN',
          `code=${code || 'ERR_FORBIDDEN'}`,
          false,
        );
      }

      // Fall through to provider/network heuristics below for other
      // CustomHttpExceptions (e.g. InternalServerErrorException with an
      // upstream Anthropic message).
    }

    // 2. Provider overload / rate-limit heuristics
    const messageBlob = this.extractMessageBlob(error).toLowerCase();
    if (
      messageBlob.includes('529') ||
      messageBlob.includes('overloaded') ||
      messageBlob.includes('rate_limit') ||
      messageBlob.includes('rate limit')
    ) {
      return this.buildEnvelope(
        'AI_OVERLOAD',
        this.buildHttpStatusDetail(error, 'provider-overload'),
        true,
      );
    }

    // 3. Network-class failures: node socket codes or HTTP 5xx from upstream
    const nodeCode = this.extractNodeErrorCode(error);
    if (
      nodeCode === 'ECONNRESET' ||
      nodeCode === 'ETIMEDOUT' ||
      nodeCode === 'ENOTFOUND'
    ) {
      return this.buildEnvelope('NETWORK', `code=${nodeCode}`, true);
    }
    const httpStatus = this.extractHttpStatus(error);
    if (httpStatus >= 500 && httpStatus < 600) {
      return this.buildEnvelope('NETWORK', `httpStatus=${httpStatus}`, true);
    }

    // 4. Default — UNKNOWN but retryable. The FE shows the userMessage and a
    // retry button; auto-classified non-retryable cases are limited to
    // BadRequest/Forbidden above.
    return this.buildEnvelope(
      'UNKNOWN',
      this.buildHttpStatusDetail(error, 'unclassified'),
      true,
    );
  }

  private buildEnvelope(
    category: BatchJobErrorCategory,
    technicalDetail: string,
    retryable: boolean,
  ): BatchJobError {
    const { headline, subline } = CATEGORY_COPY[category];
    return {
      category,
      userMessage: `${headline} ${subline}`,
      technicalDetail,
      retryable,
      occurredAt: new Date().toISOString(),
    };
  }

  /**
   * `technicalDetail` for AI_TRUNCATION should expose the input/output
   * experience counts attached by `validateNoExperienceDropped` so ops can
   * spot LLM-side regressions without grepping app logs.
   */
  private buildTruncationDetail(code: string, details: unknown): string {
    if (details && typeof details === 'object') {
      const d = details as { inputCount?: unknown; outputCount?: unknown };
      const inputCount =
        typeof d.inputCount === 'number' ? d.inputCount : undefined;
      const outputCount =
        typeof d.outputCount === 'number' ? d.outputCount : undefined;
      if (inputCount !== undefined && outputCount !== undefined) {
        return `code=${code} inputCount=${inputCount} outputCount=${outputCount}`;
      }
    }
    return `code=${code}`;
  }

  private buildHttpStatusDetail(error: unknown, fallback: string): string {
    const status = this.extractHttpStatus(error);
    if (status > 0) return `httpStatus=${status}`;
    if (error instanceof CustomHttpException) {
      const response = error.getResponse() as { errorCode?: unknown };
      const code =
        typeof response?.errorCode === 'string' ? response.errorCode : '';
      if (code) return `code=${code}`;
    }
    return fallback;
  }

  /**
   * Pull a flat lowercase blob out of whatever error shape we got — message,
   * nested response.message, etc. Used only for keyword heuristics
   * (overloaded / rate_limit). NEVER fed into `technicalDetail` (could carry
   * user input or stack frames).
   */
  private extractMessageBlob(error: unknown): string {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message ?? '';
    if (typeof error === 'object') {
      const obj = error as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
      const response = obj.response;
      if (response && typeof response === 'object') {
        const respObj = response as Record<string, unknown>;
        if (typeof respObj.message === 'string') return respObj.message;
      }
    }
    return '';
  }

  private extractNodeErrorCode(error: unknown): string | undefined {
    if (error && typeof error === 'object') {
      const code = (error as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
    return undefined;
  }

  private extractHttpStatus(error: unknown): number {
    if (!error || typeof error !== 'object') return 0;
    const obj = error as { status?: unknown; statusCode?: unknown };
    if (typeof obj.status === 'number') return obj.status;
    if (typeof obj.statusCode === 'number') return obj.statusCode;
    return 0;
  }
}
