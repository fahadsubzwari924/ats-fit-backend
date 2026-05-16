import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JOB_RELEVANCE_CONSTANTS } from '../constants/job-relevance.constants';
import {
  RELEVANCE_TOOL,
  RUBRIC_SYSTEM_BLOCK,
  buildCandidateProfileBlock,
  buildJobBlock,
} from '../prompts/job-relevance.prompt';
import { JobRelevanceVerdict } from '../enums/job-relevance-verdict.enum';
import { JobRelevanceEngine } from '../enums/job-relevance-engine.enum';
import { JobRelevanceDimensionLabel } from '../enums/job-relevance-dimension-label.enum';
import type {
  JobRelevanceResult,
  JobRelevanceDimensions,
} from '../interfaces/job-relevance.interface';

interface ScoreParams {
  profileText: string;
  jobPosition: string;
  companyName: string;
  jobDescription: string;
  abortSignal?: AbortSignal;
}

/** Raw shape returned by the Anthropic Messages API tool_use content block. */
interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

/** Validated, typed subset of ToolUseBlock.input after parseToolUse succeeds. */
interface ParsedToolInput {
  score: number;
  verdict: JobRelevanceVerdict;
  dimensions: JobRelevanceDimensions;
  gaps: string[];
  strengths: string[];
}

@Injectable()
export class JobRelevanceLlmClient {
  private readonly logger = new Logger(JobRelevanceLlmClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('ANTHROPIC_API_KEY') ?? '';
    this.baseUrl =
      this.config.get<string>('CLAUDE_CHAT_API_ENDPOINT') ??
      'https://api.anthropic.com/v1/messages';
  }

  async score(params: ScoreParams): Promise<JobRelevanceResult> {
    const started = Date.now();
    try {
      const response = await this.callWithRetry(params);
      const parsed = this.parseToolUse(response);
      if (!parsed)
        return this.buildFallback(JobRelevanceEngine.FALLBACK, started);
      return this.toResult(parsed, started);
    } catch (err) {
      const errName = (err as Error).name;
      const isExternalAbort = errName === 'AbortError';
      const isTimeout = errName === 'TimeoutError';
      if (!isExternalAbort && !isTimeout) {
        this.logger.warn(
          `LLM relevance call failed: ${(err as Error).message}`,
        );
      }
      const engine = isTimeout
        ? JobRelevanceEngine.TIMEOUT
        : JobRelevanceEngine.FALLBACK;
      return this.buildFallback(engine, started);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async callWithRetry(
    params: ScoreParams,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.callWithTimeout(params);
    } catch (firstErr) {
      const errName = (firstErr as Error).name;
      // External abort (pipeline cancelled) — never retry.
      if (errName === 'AbortError') throw firstErr;

      this.logger.warn(
        `LLM relevance first attempt failed (${errName}), retrying in ${JOB_RELEVANCE_CONSTANTS.LLM.RETRY_DELAY_MS}ms`,
      );
      await this.delay(JOB_RELEVANCE_CONSTANTS.LLM.RETRY_DELAY_MS);
      return this.callWithTimeout(params);
    }
  }

  private async callWithTimeout(
    params: ScoreParams,
  ): Promise<Record<string, unknown>> {
    const internalAc = new AbortController();
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      internalAc.abort();
    }, JOB_RELEVANCE_CONSTANTS.LLM.TIMEOUT_MS);

    const onExternalAbort = () => internalAc.abort();
    if (params.abortSignal) {
      params.abortSignal.addEventListener('abort', onExternalAbort, {
        once: true,
      });
    }

    try {
      return await this.fetchMessages(params, internalAc.signal);
    } catch (err) {
      if (timedOut) {
        const timeoutErr = new Error(
          `LLM relevance call exceeded ${JOB_RELEVANCE_CONSTANTS.LLM.TIMEOUT_MS}ms`,
        );
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (params.abortSignal) {
        params.abortSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  private async fetchMessages(
    params: ScoreParams,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const body = {
      model: JOB_RELEVANCE_CONSTANTS.LLM.MODEL,
      max_tokens: JOB_RELEVANCE_CONSTANTS.LLM.MAX_TOKENS,
      tools: [RELEVANCE_TOOL],
      tool_choice: {
        type: 'tool',
        name: JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME,
      },
      system: [
        {
          type: 'text',
          text: RUBRIC_SYSTEM_BLOCK,
          cache_control: { type: 'ephemeral' },
        },
        {
          type: 'text',
          text: buildCandidateProfileBlock(params.profileText),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: buildJobBlock(
            params.jobPosition,
            params.companyName,
            params.jobDescription,
          ),
        },
      ],
    };

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': JOB_RELEVANCE_CONSTANTS.LLM.API_VERSION,
        'anthropic-beta': JOB_RELEVANCE_CONSTANTS.LLM.BETA_HEADER,
        'User-Agent': JOB_RELEVANCE_CONSTANTS.LLM.USER_AGENT,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private parseToolUse(raw: Record<string, unknown>): ParsedToolInput | null {
    const content = raw.content;
    if (!Array.isArray(content)) return null;

    const block = content.find(
      (b) =>
        b &&
        typeof b === 'object' &&
        (b as ToolUseBlock).type === 'tool_use' &&
        (b as ToolUseBlock).name === JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME,
    ) as ToolUseBlock | undefined;

    if (!block || typeof block.input !== 'object' || block.input === null) {
      return null;
    }

    const input = block.input;

    if (typeof input.score !== 'number') return null;

    const verdictValues = Object.values(JobRelevanceVerdict) as string[];
    if (!verdictValues.includes(input.verdict as string)) return null;

    const dims = input.dimensions as
      | Record<string, { score: number; label: string }>
      | undefined;
    if (!dims?.techStack || !dims?.roleType || !dims?.experienceLevel) {
      return null;
    }

    return {
      score: Math.round(input.score),
      verdict: input.verdict as JobRelevanceVerdict,
      dimensions: {
        techStack: this.toDim(dims.techStack),
        roleType: this.toDim(dims.roleType),
        experienceLevel: this.toDim(dims.experienceLevel),
      },
      gaps: Array.isArray(input.gaps)
        ? (input.gaps as string[]).slice(0, 4)
        : [],
      strengths: Array.isArray(input.strengths)
        ? (input.strengths as string[]).slice(0, 3)
        : [],
    };
  }

  private toDim(d: { score: number; label: string }): {
    score: number;
    label: JobRelevanceDimensionLabel;
  } {
    const score = typeof d.score === 'number' ? Math.round(d.score) : 0;
    const labelValues = Object.values(JobRelevanceDimensionLabel) as string[];
    const label = labelValues.includes(d.label)
      ? (d.label as JobRelevanceDimensionLabel)
      : JobRelevanceDimensionLabel.PARTIAL;
    return { score, label };
  }

  private toResult(
    parsed: ParsedToolInput,
    started: number,
  ): JobRelevanceResult {
    return {
      ...parsed,
      engine: JobRelevanceEngine.LLM,
      model: JOB_RELEVANCE_CONSTANTS.LLM.MODEL,
      latencyMs: Date.now() - started,
      cacheKey: null,
      computedAt: new Date().toISOString(),
      acknowledgedLowFit: false,
    };
  }

  private buildFallback(
    engine: JobRelevanceEngine,
    started: number,
  ): JobRelevanceResult {
    return {
      score: 50,
      verdict: JobRelevanceVerdict.MEDIUM,
      dimensions: {
        techStack: { score: 0, label: JobRelevanceDimensionLabel.PARTIAL },
        roleType: { score: 0, label: JobRelevanceDimensionLabel.PARTIAL },
        experienceLevel: {
          score: 0,
          label: JobRelevanceDimensionLabel.PARTIAL,
        },
      },
      gaps: [],
      strengths: [],
      engine,
      model: null,
      latencyMs: Date.now() - started,
      cacheKey: null,
      computedAt: new Date().toISOString(),
      acknowledgedLowFit: false,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
