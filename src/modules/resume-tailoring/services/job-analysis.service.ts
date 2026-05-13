import { Injectable, Logger } from '@nestjs/common';
import { OpenAIService } from '../../../shared/modules/external/services/open_ai.service';
import { PromptService } from '../../../shared/services/prompt.service';
import { CacheService } from '../../../shared/services/cache.service';
import { JobAnalysisResult } from '../interfaces/job-analysis.interface';
import {
  InternalServerErrorException,
  BadRequestException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { JD_ANALYSIS_PROMPT_VERSION } from '../../../shared/constants/prompt-versions.constants';
import {
  MODEL_JD_ANALYSIS,
  TEMP_JD_ANALYSIS,
  MAX_TOKENS_JD_ANALYSIS,
} from '../../../shared/constants/resume-tailoring.constants';
import { get, head, isEmpty } from 'lodash';
import { JobAnalysisJsonSchema } from '../types/job-analysis.json-schema';
import {
  ChatCompletionChoice,
  ChatCompletionResponse,
} from '../../../shared/modules/external/interfaces/open-ai-chat.interface';

/**
 * Job Analysis Service
 *
 * Uses GPT-4 Turbo for comprehensive job analysis and keyword extraction.
 * This service focuses solely on understanding job requirements without any resume comparison.
 *
 * Key features:
 * - Comprehensive job analysis and requirements extraction
 * - Intelligent keyword categorization for ATS optimization
 * - Context-aware analysis for tailoring strategies
 * - Enhanced error handling and validation
 * - Performance-optimized caching for repeated analyses
 */
@Injectable()
export class JobAnalysisService {
  private readonly logger = new Logger(JobAnalysisService.name);

  constructor(
    private readonly openAIService: OpenAIService,
    private readonly promptService: PromptService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Analyze job description and extract comprehensive requirements
   *
   * @param jobDescription - Raw job description text
   * @param jobPosition - Job position title (for additional context)
   * @param companyName - Company name (for context-aware analysis)
   * @returns Promise<JobAnalysisResult> - Comprehensive job analysis
   */
  async analyzeJobDescription(
    jobDescription: string,
    jobPosition: string,
    companyName: string,
  ): Promise<JobAnalysisResult> {
    const startTime = Date.now();

    // Use shared cache with job analysis namespace
    const cacheKeyData = {
      jobDescription: jobDescription.trim(),
      jobPosition: jobPosition.trim(),
      companyName: companyName.trim(),
      promptVersion: JD_ANALYSIS_PROMPT_VERSION,
    };

    // Try to get from cache first
    const cached = this.cacheService.get<JobAnalysisResult>(
      this.cacheService.generateKey(cacheKeyData),
      'job-analysis',
    );

    if (cached) {
      this.logger.debug(
        `Cache hit for job analysis in ${Date.now() - startTime}ms`,
      );
      return cached;
    }

    try {
      this.validateInputs(jobDescription, jobPosition, companyName);

      this.logger.log(
        `Starting job description analysis for position: ${jobPosition} at ${companyName}`,
      );

      const { system, user } =
        this.promptService.getJobDescriptionAnalysisPromptParts(
          jobDescription,
          jobPosition,
          companyName,
        );

      const response = await this.openAIService.chatCompletion({
        model: MODEL_JD_ANALYSIS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'job_analysis',
            strict: true,
            schema: JobAnalysisJsonSchema,
          },
        },
        temperature: TEMP_JD_ANALYSIS,
        max_tokens: MAX_TOKENS_JD_ANALYSIS,
        promptId: 'jd-analysis',
        promptVersion: JD_ANALYSIS_PROMPT_VERSION,
      });

      const result = this.parseAnalysisResponse(response);
      this.logger.log(
        `Job description analysis response parsed successfully: ${JSON.stringify(result)}`,
      );

      // Normalize whichever shape/key the LLM emitted (`aliases` or legacy
      // `synonyms`; canonical array or legacy map) into the canonical
      // `[{term, alternatives}]` form. Persist under BOTH `keywords.aliases`
      // (new canonical) and `keywords.synonyms` (legacy mirror) so existing
      // downstream readers keep working for one prompt-version cycle.
      const rawKeywords = (result.keywords ?? {}) as Record<string, unknown>;
      const aliasSource =
        rawKeywords.aliases !== undefined
          ? rawKeywords.aliases
          : rawKeywords.synonyms;
      const canonicalAliases = this.normalizeAliases(aliasSource);

      const finalResult = {
        ...result,
        keywords: {
          ...result.keywords,
          aliases: canonicalAliases,
          synonyms: canonicalAliases,
        },
        metadata: {
          ...result.metadata,
          processedAt: new Date(),
        },
      };

      // Cache the result using shared cache service
      this.cacheService.set(
        this.cacheService.generateKey(cacheKeyData),
        finalResult,
        {
          ttl: 24 * 60 * 60 * 1000, // 24 hours
          namespace: 'job-analysis',
        },
      );

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `Job analysis completed in ${processingTime}ms. Extracted ${result.technical.mandatorySkills.length} mandatory skills and ${result.keywords.primary.length} primary keywords`,
      );

      return finalResult;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Job description analysis failed after ${processingTime}ms`,
        error,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to analyze job description',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Parse and validate the analysis response from OpenAI
   */
  private parseAnalysisResponse(response: ChatCompletionResponse): Omit<
    JobAnalysisResult,
    'metadata'
  > & {
    metadata: Omit<JobAnalysisResult['metadata'], 'processedAt'>;
  } {
    const choices = get(response, 'choices', []) as ChatCompletionChoice[];
    if (isEmpty(choices)) {
      throw new InternalServerErrorException(
        'No response received from OpenAI',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    const content = get(head(choices), 'message.content');
    if (!content) {
      throw new InternalServerErrorException(
        'Empty response from OpenAI',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    try {
      const parsedResult: unknown = JSON.parse(content);
      return parsedResult as Omit<JobAnalysisResult, 'metadata'> & {
        metadata: Omit<JobAnalysisResult['metadata'], 'processedAt'>;
      };
    } catch (error: unknown) {
      this.logger.error('Failed to parse job analysis response', {
        content: content.substring(0, 500),
        error:
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : JSON.stringify(error),
      });
      throw new InternalServerErrorException(
        'Failed to parse job analysis response',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Normalize the LLM's `keywords.aliases` (or legacy `keywords.synonyms`)
   * payload into the canonical shape used by downstream consumers.
   *
   * Accepts:
   *  - Canonical array `[{term, alternatives}]` (current contract) → returned
   *    as-is after per-entry type-checking.
   *  - Legacy map `{ keyword: ["syn1", "syn2"] }` → converted to the canonical
   *    array (one entry per key).
   *  - `undefined` / `null` / malformed input → returns `[]`.
   *
   * Always returns the canonical `Array<{ term: string; alternatives: string[] }>` shape.
   */
  private normalizeAliases(
    raw: unknown,
  ): Array<{ term: string; alternatives: string[] }> {
    if (!raw) return [];

    const cleanAlternatives = (alternatives: unknown): string[] => {
      if (!Array.isArray(alternatives)) return [];
      return alternatives
        .filter((a): a is string => typeof a === 'string')
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
    };

    if (Array.isArray(raw)) {
      const out: Array<{ term: string; alternatives: string[] }> = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as { term?: unknown; alternatives?: unknown };
        if (typeof e.term !== 'string') continue;
        const term = e.term.trim();
        if (!term) continue;
        const alternatives = cleanAlternatives(e.alternatives);
        out.push({ term, alternatives });
      }
      return out;
    }

    if (typeof raw === 'object') {
      const out: Array<{ term: string; alternatives: string[] }> = [];
      for (const [term, alternatives] of Object.entries(
        raw as Record<string, unknown>,
      )) {
        const trimmedTerm = term.trim();
        if (!trimmedTerm) continue;
        out.push({
          term: trimmedTerm,
          alternatives: cleanAlternatives(alternatives),
        });
      }
      return out;
    }

    return [];
  }

  /**
   * Validate input parameters
   */
  private validateInputs(
    jobDescription: string,
    jobPosition: string,
    companyName: string,
  ): void {
    if (!jobDescription || typeof jobDescription !== 'string') {
      throw new BadRequestException(
        'Job description is required and must be a string',
        ERROR_CODES.INVALID_JOB_DESCRIPTION,
      );
    }

    if (jobDescription.trim().length < 50) {
      throw new BadRequestException(
        'Job description must be at least 50 characters long',
        ERROR_CODES.INVALID_JOB_DESCRIPTION,
      );
    }

    if (jobDescription.length > 15000) {
      throw new BadRequestException(
        'Job description cannot exceed 15,000 characters',
        ERROR_CODES.INVALID_JOB_DESCRIPTION,
      );
    }

    if (!jobPosition || typeof jobPosition !== 'string') {
      throw new BadRequestException(
        'Job position is required and must be a string',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    if (jobPosition.trim().length < 2) {
      throw new BadRequestException(
        'Job position must be at least 2 characters long',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    if (!companyName || typeof companyName !== 'string') {
      throw new BadRequestException(
        'Company name is required and must be a string',
        ERROR_CODES.INVALID_COMPANY_NAME,
      );
    }

    if (companyName.trim().length < 2) {
      throw new BadRequestException(
        'Company name must be at least 2 characters long',
        ERROR_CODES.INVALID_COMPANY_NAME,
      );
    }
  }
}
