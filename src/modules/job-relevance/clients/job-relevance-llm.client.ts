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
  MandatoryTechAnalysis,
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
  /**
   * Derived server-side from `mandatoryTechs` — the LLM no longer emits a
   * separate `gaps` field. See `parseToolUse` for the derivation.
   */
  gaps: string[];
  strengths: string[];
  /** Full LLM enumeration, also surfaced on the result for audit. */
  mandatoryTechs: MandatoryTechAnalysis[];
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
      if (!parsed) {
        // Loud telemetry on the silent-fallback path. Capture stop_reason
        // (max_tokens / tool_use / end_turn / error) + the content-block
        // shape so future regressions are obvious in logs instead of
        // showing up as a "50% / empty arrays" customer complaint.
        const stopReason = (response as { stop_reason?: unknown }).stop_reason;
        const usage = (response as { usage?: unknown }).usage;
        const content = (response as { content?: unknown }).content;
        const contentShape = Array.isArray(content)
          ? content.map((b) => (b as { type?: string })?.type ?? 'unknown')
          : 'not-array';
        this.logger.error(
          JSON.stringify({
            event: 'job_relevance.parse_tool_use_failed',
            stopReason,
            usage,
            contentShape,
            hint:
              stopReason === 'max_tokens'
                ? 'Response was TRUNCATED by max_tokens. Bump JOB_RELEVANCE_CONSTANTS.LLM.MAX_TOKENS or shrink schema.'
                : 'Tool block missing or malformed — check that the model used the tool and the schema is valid.',
          }),
        );
        return this.buildFallback(JobRelevanceEngine.FALLBACK, started);
      }
      return this.toResult(parsed, started);
    } catch (err) {
      const errName = (err as Error).name;
      const isExternalAbort = errName === 'AbortError';
      const isTimeout = errName === 'TimeoutError';
      const elapsedMs = Date.now() - started;

      // Loud, structured logs on EVERY fallback path. Previously timeouts
      // were silent (no log at all) and API errors were warn-only with no
      // context. Now every "user sees 50%/empty arrays" outcome leaves a
      // grep-friendly trail in the logs:
      //   event=job_relevance.timeout           — bump TIMEOUT_MS or shrink schema
      //   event=job_relevance.llm_api_error     — schema rejection / 4xx / 5xx
      //   event=job_relevance.aborted           — external cancel (not a bug)
      if (isTimeout) {
        this.logger.error(
          JSON.stringify({
            event: 'job_relevance.timeout',
            elapsedMs,
            timeoutMs: JOB_RELEVANCE_CONSTANTS.LLM.TIMEOUT_MS,
            maxTokens: JOB_RELEVANCE_CONSTANTS.LLM.MAX_TOKENS,
            jobPosition: params.jobPosition,
            companyName: params.companyName,
            hint: 'LLM exceeded TIMEOUT_MS. Either bump it or shrink the response (MANDATORY_TECHS_MAX, schema item caps).',
          }),
        );
      } else if (isExternalAbort) {
        // Pipeline cancelled (low-fit abort, user navigation). Not a bug.
        this.logger.debug(
          JSON.stringify({
            event: 'job_relevance.aborted',
            elapsedMs,
            jobPosition: params.jobPosition,
            companyName: params.companyName,
          }),
        );
      } else {
        this.logger.error(
          JSON.stringify({
            event: 'job_relevance.llm_api_error',
            elapsedMs,
            errorName: errName,
            errorMessage: (err as Error).message,
            jobPosition: params.jobPosition,
            companyName: params.companyName,
          }),
          err instanceof Error ? err.stack : undefined,
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

    const mandatoryTechs = this.parseMandatoryTechs(input.mandatoryTechs);

    return {
      score: Math.round(input.score),
      verdict: input.verdict as JobRelevanceVerdict,
      dimensions: {
        techStack: this.toDim(dims.techStack),
        roleType: this.toDim(dims.roleType),
        experienceLevel: this.toDim(dims.experienceLevel),
      },
      // Server-side derivation: gaps = mandatoryTechs missing from profile.
      // Trim to top 4 in the order the LLM listed them (most critical first
      // per the rubric). This guarantees parity between the structured
      // analysis and the user-facing gaps list — empty `gaps` is now only
      // possible when every mandatory tech is genuinely present.
      gaps: this.deriveGaps(mandatoryTechs),
      strengths: Array.isArray(input.strengths)
        ? (input.strengths as string[]).slice(0, 3)
        : [],
      mandatoryTechs,
    };
  }

  /**
   * Parse + validate the LLM's `mandatoryTechs` array. Drops malformed
   * entries silently rather than throwing — partial structured data is more
   * useful than no data, and the schema's `minItems: 1` at the API layer
   * already prevented the worst case (empty array).
   */
  private parseMandatoryTechs(raw: unknown): MandatoryTechAnalysis[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item): item is Record<string, unknown> => {
        if (!item || typeof item !== 'object') return false;
        return (
          typeof (item as Record<string, unknown>).name === 'string' &&
          typeof (item as Record<string, unknown>).presentInProfile ===
            'boolean'
        );
      })
      .map((item) => {
        const result: MandatoryTechAnalysis = {
          name: (item.name as string).trim(),
          presentInProfile: item.presentInProfile as boolean,
        };
        if (typeof item.evidence === 'string' && item.evidence.trim()) {
          result.evidence = item.evidence.trim();
        }
        return result;
      })
      .filter((item) => item.name.length > 0)
      .slice(0, JOB_RELEVANCE_CONSTANTS.MANDATORY_TECHS_MAX);
  }

  /**
   * Derive the user-facing `gaps` array from the structured tech analysis.
   * The LLM lists mandatoryTechs in priority order (rubric-instructed), so
   * we simply filter to missing and cap at 4 — no resorting needed.
   */
  private deriveGaps(techs: MandatoryTechAnalysis[]): string[] {
    return techs
      .filter((t) => !t.presentInProfile)
      .map((t) => t.name)
      .slice(0, JOB_RELEVANCE_CONSTANTS.GAPS_MAX);
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
      mandatoryTechs: [],
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
