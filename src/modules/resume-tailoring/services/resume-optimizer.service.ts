import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClaudeService } from '../../../shared/modules/external/services/claude.service';
import { OpenAIService } from '../../../shared/modules/external/services/open_ai.service';
import { PromptService } from '../../../shared/services/prompt.service';
import { CacheService } from '../../../shared/services/cache.service';
import { AIErrorUtil } from '../../../shared/utils/ai-error.util';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import { JobAnalysisResult } from '../interfaces/job-analysis.interface';
import { ResumeOptimizationResult } from '../interfaces/resume-optimization.interface';
import {
  InternalServerErrorException,
  BadRequestException,
  CustomHttpException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { ClaudeResponse } from '../../../shared/modules/external/interfaces';
import { ChatCompletionResponse } from '../../../shared/modules/external/interfaces/open-ai-chat.interface';
import { get, head } from 'lodash';
import {
  TailoringModeResult,
  VerifiedFact,
} from '../interfaces/user-context.interface';
import { BulletRelevanceScoringService } from './bullet-relevance-scoring.service';
import { ExperienceTechAllowlistService } from './experience-tech-allowlist.service';
import { PromptVariantResolverService } from './prompt-variant-resolver.service';
import {
  BULLET_BUDGET_PER_RANK,
  MAX_TOKENS_OPTIMIZATION,
  MAX_TOKENS_OPTIMIZATION_WITH_THINKING,
  EXTENDED_THINKING_BUDGET_TOKENS,
  MODEL_OPTIMIZER_FALLBACK,
  TEMP_OPTIMIZER,
} from '../../../shared/constants/resume-tailoring.constants';
import { AB_EXPERIMENT_KEYS } from '../constants/ab-experiments.constants';
import { ResumeOptimizationJsonSchema } from '../types/resume-optimization.json-schema';
import { OPTIMIZATION_PROMPT_VERSION } from '../../../shared/constants/prompt-versions.constants';
import { RETURN_OPTIMIZED_RESUME_TOOL } from '../types/claude-tools';
import { ResumeOptimizationResultSchema } from '../schemas/resume-optimization-result.schema';

// changesDiff has been removed from the AI response — it is computed
// programmatically in a background Bull job (ChangesDiffProcessor).

/**
 * AI Resume Optimizer Service V2
 *
 * Uses Claude 3.5 Sonnet for intelligent resume content optimization.
 * This service takes job analysis results and candidate resume content
 * to generate highly tailored, ATS-optimized resume content.
 *
 * Key features:
 * - Advanced job-resume alignment using AI
 * - Quantifiable achievement enhancement
 * - ATS keyword optimization
 * - Industry-specific tailoring
 * - Performance and impact metrics tracking
 *
 * AI Model Choice: Claude 3.5 Sonnet
 * - Superior at content generation and creative writing
 * - Better understanding of professional context
 * - Excellent at maintaining original voice while optimizing
 * - Strong performance on structured output generation
 */
@Injectable()
export class ResumeOptimizerService {
  private readonly logger = new Logger(ResumeOptimizerService.name);

  constructor(
    private readonly claudeService: ClaudeService,
    private readonly openAIService: OpenAIService,
    private readonly promptService: PromptService,
    private readonly cacheService: CacheService,
    private readonly bulletRelevanceScoringService: BulletRelevanceScoringService,
    private readonly experienceTechAllowlistService: ExperienceTechAllowlistService,
    private readonly configService: ConfigService,
    private readonly promptVariantResolverService: PromptVariantResolverService,
  ) {}

  /**
   * Generate optimized resume content based on job analysis and candidate profile
   *
   * @param jobAnalysis - Comprehensive job analysis result
   * @param candidateContent - Current resume content structure
   * @param companyName - Target company name
   * @param jobPosition - Target job position
   * @param tailoringMode - When precision/enhanced with verified facts, uses zero-hallucination prompt
   * @param verifiedFacts - User Q&A facts (source of truth) from profile questions
   * @returns Promise<ResumeOptimizationResult> - Optimized resume with metrics
   */
  async optimizeResumeContent(
    jobAnalysis: JobAnalysisResult,
    candidateContent: TailoredContent,
    companyName: string,
    jobPosition: string,
    tailoringMode?: TailoringModeResult,
    verifiedFacts?: VerifiedFact[],
    userId?: string,
  ): Promise<ResumeOptimizationResult> {
    const startTime = Date.now();

    try {
      this.validateInputs(
        jobAnalysis,
        candidateContent,
        companyName,
        jobPosition,
      );

      const variant = this.promptVariantResolverService.resolve(
        userId ?? '',
        AB_EXPERIMENT_KEYS.OPTIMIZER_CONSTITUTIONAL_RUBRIC,
      );

      // Always key on facts digest so partial-answer updates never hit a stale cache entry
      const verifiedFactsDigest = JSON.stringify(verifiedFacts ?? []);

      // Use shared cache for optimization results
      const cacheKeyData = {
        jobSkills: jobAnalysis.technical.mandatorySkills.sort(),
        jobKeywords: jobAnalysis.keywords.primary.sort(),
        position: jobPosition,
        company: companyName,
        experience: candidateContent.experience,
        skills: candidateContent.skills,
        education: candidateContent.education,
        tailoringMode: tailoringMode ?? 'standard',
        verifiedFactsDigest,
        promptVersion: PromptService.OPTIMIZATION_PROMPT_VERSION,
        abVariant: variant,
      };

      // Check cache first
      const cached = this.cacheService.get<ResumeOptimizationResult>(
        this.cacheService.generateKey(cacheKeyData),
        'resume-optimization',
      );

      if (cached) {
        this.logger.debug(
          `Cache hit for optimization in ${Date.now() - startTime}ms`,
        );
        return cached;
      }

      this.logger.log(
        `Starting AI resume optimization for ${jobPosition} at ${companyName}`,
      );

      // Pre-rank bullets by JD relevance before sending to LLM.
      // This ensures every job is included with its most relevant bullets sized by rank.
      const jdKeywords = [
        ...(jobAnalysis.keywords?.primary ?? []),
        ...(jobAnalysis.technical?.mandatorySkills ?? []),
        ...(jobAnalysis.technical?.frameworks ?? []),
      ];
      const rankedBullets =
        this.bulletRelevanceScoringService.getTopBulletsPerExperience(
          candidateContent.experience,
          jdKeywords,
          BULLET_BUDGET_PER_RANK,
        );

      const jdTechTokens = [
        ...(jobAnalysis.keywords?.primary ?? []),
        ...(jobAnalysis.technical?.mandatorySkills ?? []),
        ...(jobAnalysis.technical?.frameworks ?? []),
        ...(jobAnalysis.technical?.programmingLanguages ?? []),
        ...(jobAnalysis.technical?.tools ?? []),
        ...(jobAnalysis.technical?.databases ?? []),
      ];

      const preAllowlistContent: TailoredContent = {
        ...candidateContent,
        experience: candidateContent.experience.map((exp, idx) => ({
          ...exp,
          responsibilities: rankedBullets[idx]?.bullets ?? exp.responsibilities,
          achievements: [],
        })),
      };

      const allowlistPerExperience =
        this.experienceTechAllowlistService.buildAllowlist(preAllowlistContent);

      const techVocabulary =
        this.experienceTechAllowlistService.buildTechVocabulary(
          preAllowlistContent,
          jdTechTokens,
        );

      const rankedCandidateContent: TailoredContent = {
        ...preAllowlistContent,
        experience: preAllowlistContent.experience.map((exp, idx) => ({
          ...exp,
          allowedTech: Array.from(allowlistPerExperience[idx] ?? []),
        })),
      };

      // Two-tier retry: attempt 1 (Claude w/ 529→OpenAI fallback) → attempt 2
      // (Claude only, cache-bypassed) → OpenAI fallback on validation failure.
      // Cache was already consulted above; retries and OpenAI fallback MUST NOT
      // re-read cache (they would just return the cached failure).
      let result: Omit<ResumeOptimizationResult, 'processingMetadata'>;
      let aiModel: string;
      let outcomeLabel: '1' | '2' | 'openai-fallback';

      try {
        const attempt1 = await this.runOptimizationAttempt(
          jobAnalysis,
          rankedCandidateContent,
          companyName,
          jobPosition,
          verifiedFacts,
          variant,
          allowlistPerExperience,
          techVocabulary,
          1,
        );
        result = attempt1.result;
        aiModel = attempt1.aiModel;
        outcomeLabel = '1';
      } catch (error) {
        if (!this.isRetryableOptimizerError(error)) {
          throw error;
        }

        const prevCount = this.extractOutputCount(error);
        this.logger.warn(
          `Optimizer retry attempt=2 reason=parsing-validation-failed previous_output_count=${prevCount}`,
        );

        try {
          const attempt2 = await this.runOptimizationAttempt(
            jobAnalysis,
            rankedCandidateContent,
            companyName,
            jobPosition,
            verifiedFacts,
            variant,
            allowlistPerExperience,
            techVocabulary,
            2,
          );
          result = attempt2.result;
          aiModel = attempt2.aiModel;
          outcomeLabel = '2';
        } catch (secondError) {
          if (!this.isRetryableOptimizerError(secondError)) {
            throw secondError;
          }

          this.logger.warn(
            'Falling through to OpenAI fallback after 2 Claude attempts failed validation',
          );

          try {
            const openAIResult = await this.optimizeWithOpenAI(
              jobAnalysis,
              rankedCandidateContent,
              companyName,
              jobPosition,
              verifiedFacts,
              variant,
            );

            this.applyPostLLMProcessing(
              openAIResult,
              rankedCandidateContent,
              verifiedFacts,
              allowlistPerExperience,
              techVocabulary,
            );

            result = openAIResult;
            aiModel = MODEL_OPTIMIZER_FALLBACK;
            outcomeLabel = 'openai-fallback';
          } catch (fallbackError) {
            // If OpenAI fallback ALSO fails validation, propagate the ORIGINAL
            // parsing-failure error so the downstream classifier maps it
            // consistently (Task D).
            if (this.isRetryableOptimizerError(fallbackError)) {
              throw error;
            }
            throw fallbackError;
          }
        }
      }

      const processingTime = Date.now() - startTime;

      this.logger.log(
        `Resume optimization completed in ${processingTime}ms. Added ${result.optimizationMetrics.keywordsAdded} keywords, optimized ${result.optimizationMetrics.sectionsOptimized} sections`,
      );

      this.logger.log(
        `Optimizer final outcome attempt=${outcomeLabel} duration_ms=${processingTime}`,
      );

      const finalResult = {
        ...result,
        processingMetadata: {
          aiModel: aiModel,
          processingTimeMs: processingTime,
        },
      };

      // Cache the result using shared cache service
      this.cacheService.set(
        this.cacheService.generateKey(cacheKeyData),
        finalResult,
        {
          ttl: 24 * 60 * 60 * 1000, // 24 hours
          namespace: 'resume-optimization',
        },
      );

      return finalResult;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Resume optimization failed after ${processingTime}ms`,
        error,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to optimize resume content',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Run a single optimization attempt: Claude (with 529-overload OpenAI
   * fallback) → scrub invented metrics → restore source skills → validate no
   * experience dropped. Returns the parsed result + the AI model label used.
   *
   * The 529-overload OpenAI fallback fires here because it's an Anthropic-
   * error fallback, not a validation-failure fallback. The retry loop in
   * `optimizeResumeContent` handles validation-failure recovery on top of
   * this helper.
   */
  private async runOptimizationAttempt(
    jobAnalysis: JobAnalysisResult,
    rankedCandidateContent: TailoredContent,
    companyName: string,
    jobPosition: string,
    verifiedFacts: VerifiedFact[] | undefined,
    variant: string,
    allowlistPerExperience: Array<Set<string>>,
    techVocabulary: Set<string>,
    attempt: number,
  ): Promise<{
    result: Omit<ResumeOptimizationResult, 'processingMetadata'>;
    aiModel: string;
  }> {
    let result: Omit<ResumeOptimizationResult, 'processingMetadata'>;
    let aiModel: string;

    try {
      result = await this.optimizeWithClaude(
        jobAnalysis,
        rankedCandidateContent,
        companyName,
        jobPosition,
        verifiedFacts,
        variant,
        attempt,
      );
      aiModel = this.claudeService.defaultModel;
      this.logger.log(
        `Successfully used Claude for resume optimization (attempt=${attempt})`,
      );
    } catch (error) {
      this.logger.debug(
        `Claude optimization failed (attempt=${attempt}), checking if overload error: ${JSON.stringify(
          {
            message: error instanceof Error ? error.message : 'Unknown error',
            type: typeof error,
            isOverload: AIErrorUtil.isClaudeOverloadError(error),
          },
        )}`,
      );

      if (AIErrorUtil.isClaudeOverloadError(error)) {
        this.logger.warn(
          `Claude API overloaded (attempt=${attempt}), falling back to OpenAI for resume optimization`,
        );
        result = await this.optimizeWithOpenAI(
          jobAnalysis,
          rankedCandidateContent,
          companyName,
          jobPosition,
          verifiedFacts,
          variant,
        );
        aiModel = MODEL_OPTIMIZER_FALLBACK;
        this.logger.log(
          `Successfully used OpenAI fallback for resume optimization (attempt=${attempt})`,
        );
      } else {
        // Re-throw non-overload errors so the outer retry loop can decide
        // whether to retry (parsing-validation failures) or propagate.
        throw error;
      }
    }

    this.applyPostLLMProcessing(
      result,
      rankedCandidateContent,
      verifiedFacts,
      allowlistPerExperience,
      techVocabulary,
    );

    return { result, aiModel };
  }

  /**
   * Apply the deterministic post-LLM pipeline: sanitize summary, scrub
   * invented metrics, restore source skills, validate no experience dropped.
   * Mutates the passed-in result. Throws `AI_RESPONSE_PARSING_FAILED` from
   * `validateNoExperienceDropped` if the LLM truncated the experience list.
   */
  private applyPostLLMProcessing(
    result: Omit<ResumeOptimizationResult, 'processingMetadata'>,
    rankedCandidateContent: TailoredContent,
    verifiedFacts: VerifiedFact[] | undefined,
    allowlistPerExperience: Array<Set<string>>,
    techVocabulary: Set<string>,
  ): void {
    result.optimizedContent.summary = this.sanitizeSummary(
      result.optimizedContent.summary,
    );

    this.scrubInventedMetrics(
      result.optimizedContent,
      rankedCandidateContent,
      verifiedFacts ?? [],
      allowlistPerExperience,
      techVocabulary,
    );

    this.restoreSourceSkills(result.optimizedContent, rankedCandidateContent);

    // Post-LLM validation: ensure no experience or bullet was silently dropped
    this.validateNoExperienceDropped(
      rankedCandidateContent,
      result.optimizedContent,
    );
  }

  /**
   * Whitelist check: is this error one of the LLM-output-quality failures
   * that the two-tier retry is allowed to recover from?
   *
   * - `AI_OUTPUT_TRUNCATED` — validation guard caught a dropped experience
   *   (the dominant failure mode this retry loop was built for).
   * - `AI_RESPONSE_PARSING_FAILED` — JSON parse / structural validation
   *   failure on the LLM payload.
   * - `MISSING_REQUIRED_AI_FIELD` — Claude can return a structurally-
   *   malformed payload (e.g. stringified nested objects) that the
   *   Anthropic tool_use API does not catch because it doesn't strictly
   *   enforce nested types; the OpenAI fallback should rescue the user.
   *
   * Anything else (BadRequestException, ForbiddenException, Anthropic 5xx
   * that bubbled past the overload handler, etc.) propagates unchanged so
   * we never retry on bad user input or quota errors.
   */
  private isRetryableOptimizerError(error: unknown): boolean {
    if (!(error instanceof CustomHttpException)) {
      return false;
    }
    const response = error.getResponse() as { errorCode?: unknown };
    const code = response?.errorCode;
    return (
      code === ERROR_CODES.AI_OUTPUT_TRUNCATED ||
      code === ERROR_CODES.AI_RESPONSE_PARSING_FAILED ||
      code === ERROR_CODES.MISSING_REQUIRED_AI_FIELD
    );
  }

  /**
   * Extract the output experience count attached to a validation-failure
   * error's `details` payload. Returns `'unknown'` when the error doesn't
   * carry that metadata (e.g. parse failures from `parseOptimizationResponse`).
   */
  private extractOutputCount(error: unknown): string {
    if (!(error instanceof CustomHttpException)) {
      return 'unknown';
    }
    const response = error.getResponse() as { details?: unknown };
    const details = response?.details as { outputCount?: unknown } | null;
    if (
      details &&
      typeof details === 'object' &&
      typeof details.outputCount === 'number'
    ) {
      return String(details.outputCount);
    }
    return 'unknown';
  }

  /**
   * Parse and validate the optimization response from Claude
   */
  private parseOptimizationResponse(
    response: ClaudeResponse,
  ): Omit<ResumeOptimizationResult, 'processingMetadata'> {
    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new InternalServerErrorException(
        'Empty response from Claude',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    try {
      const parsedResult = JSON.parse(content) as Record<string, unknown>;
      this.coerceStringifiedFields(parsedResult, 'claude');
      this.validateOptimizationResult(parsedResult);

      return parsedResult as unknown as Omit<
        ResumeOptimizationResult,
        'processingMetadata'
      >;
    } catch (error: unknown) {
      this.logger.error('Failed to parse optimization response', {
        content: content.substring(0, 500),
        error,
      });
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to parse optimization response',
        ERROR_CODES.AI_RESPONSE_PARSING_FAILED,
      );
    }
  }

  private coerceStringifiedFields(
    parsed: Record<string, unknown>,
    source: 'claude' | 'openai',
  ): void {
    const fields: Array<'optimizedContent' | 'optimizationMetrics'> = [
      'optimizedContent',
      'optimizationMetrics',
    ];

    for (const field of fields) {
      const value = parsed[field];
      if (typeof value !== 'string') continue;

      try {
        parsed[field] = JSON.parse(value);
        this.logger.warn('hallucinated_stringified_payload', {
          source,
          field,
        });
      } catch {
        // Leave the field as-is; validateOptimizationResult will throw a clear error.
      }
    }
  }

  private validateOptimizationResult(result: unknown): void {
    const parsed = ResumeOptimizationResultSchema.safeParse(result);
    if (parsed.success) return;

    const issue = parsed.error.issues[0];
    const path = issue.path.join('.') || '(root)';

    if (
      (issue.code === 'too_small' || issue.code === 'too_big') &&
      path === 'optimizationMetrics.confidenceScore'
    ) {
      throw new BadRequestException(
        'Invalid confidence score',
        ERROR_CODES.INVALID_CONFIDENCE_SCORE,
      );
    }

    if (
      issue.code === 'invalid_type' &&
      path.startsWith('optimizationMetrics.')
    ) {
      const field = path.split('.').slice(1).join('.');
      throw new BadRequestException(
        `Invalid metric field: ${field}`,
        ERROR_CODES.INVALID_METRIC_FIELD,
      );
    }

    throw new InternalServerErrorException(
      `Missing or invalid AI response field: ${path}`,
      ERROR_CODES.MISSING_REQUIRED_AI_FIELD,
    );
  }

  private sanitizeSummary(summary: string): string {
    if (!summary) return summary;

    const lines = summary
      .split('\n')
      .map((line) =>
        line
          .replace(/^[\s]*[-•*–][\s]+/, '')
          .replace(/^[\s]*\d+[.)]\s+/, '')
          .trim(),
      )
      .filter((line) => line.length > 0);

    const paragraph = lines
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const sentences = paragraph.match(/[^.!?]+[.!?]+/g) ?? [paragraph];
    return sentences.slice(0, 3).join(' ').trim();
  }

  /**
   * Verify the LLM output contains all experience entries and no bullet count regression.
   * Throws InternalServerErrorException with a diff log if validation fails.
   */
  private validateNoExperienceDropped(
    input: TailoredContent,
    output: TailoredContent,
  ): void {
    const inputCount = input.experience.length;
    const outputCount = output.experience?.length ?? 0;

    if (outputCount < inputCount) {
      const missing = inputCount - outputCount;
      this.logger.error(
        `Post-LLM validation FAILED: ${missing} experience(s) dropped. ` +
          `Input had ${inputCount} jobs, output has ${outputCount}.`,
        {
          inputCompanies: input.experience.map((e) => e.company),
          outputCompanies: output.experience?.map((e) => e.company) ?? [],
        },
      );
      throw new InternalServerErrorException(
        'Resume optimization produced incomplete output — some work experiences were dropped. Please try again.',
        ERROR_CODES.AI_OUTPUT_TRUNCATED,
        undefined,
        { inputCount, outputCount },
      );
    }

    // Warn (not throw) when individual experience has fewer bullets than provided
    input.experience.forEach((inputExp, idx) => {
      const outputExp = output.experience?.[idx];
      if (!outputExp) return;
      const inputBullets =
        (inputExp.responsibilities?.length ?? 0) +
        (inputExp.achievements?.length ?? 0);
      const outputBullets =
        (outputExp.responsibilities?.length ?? 0) +
        (outputExp.achievements?.length ?? 0);
      if (outputBullets < inputBullets) {
        this.logger.warn(
          `Bullet count regression for "${inputExp.company}" (experience #${idx}): ` +
            `input=${inputBullets}, output=${outputBullets}`,
        );
      }
    });
  }

  private scrubInventedMetrics(
    optimizedContent: TailoredContent,
    sourceContent: TailoredContent,
    verifiedFacts: VerifiedFact[],
    allowlistPerExperience: Array<Set<string>> = [],
    techVocabulary: Set<string> = new Set<string>(),
  ): void {
    const verifiedText = verifiedFacts.map((f) => f.userResponse).join('\n');

    for (let i = 0; i < optimizedContent.experience.length; i++) {
      const outputExp = optimizedContent.experience[i];
      const sourceExp = sourceContent.experience[i];
      const allowlist = allowlistPerExperience[i] ?? new Set<string>();

      for (const field of ['responsibilities', 'achievements'] as const) {
        const outputBullets = outputExp[field] ?? [];
        const sourceBullets = sourceExp?.[field] ?? [];

        outputExp[field] = outputBullets.map((bullet, j) => {
          const sourceBullet = sourceBullets[j] ?? '';

          // Class B — technology substitution check (runs BEFORE metric check
          // because a tech swap is a stronger signal than a metric change).
          if (techVocabulary.size > 0 && sourceBullet) {
            const forbiddenTech =
              this.experienceTechAllowlistService.detectForbiddenTokens(
                bullet,
                sourceBullet,
                allowlist,
                techVocabulary,
              );
            if (forbiddenTech.length > 0) {
              this.logger.warn(
                'hallucinated_tech detected — reverting bullet to source',
                {
                  experienceIndex: i,
                  bulletIndex: j,
                  offendingTokens: forbiddenTech,
                  outputBullet: bullet,
                  sourceBullet,
                },
              );
              return sourceBullet;
            }
          }

          // Class A — numeric hallucination check (existing behavior).
          const tokens = bullet.match(/\d+[%xkK]?|\$[\d,]+/g) ?? [];
          if (tokens.length === 0) return bullet;

          const sourceFieldText = sourceBullets.join('\n');
          const failingTokens = tokens.filter(
            (token) =>
              !sourceFieldText.includes(token) && !verifiedText.includes(token),
          );

          if (failingTokens.length === 0) return bullet;

          if (!sourceBullet) {
            this.logger.warn(
              'hallucinated_metric on out-of-bounds bullet — keeping original',
              {
                experienceIndex: i,
                bulletIndex: j,
                offendingTokens: failingTokens,
                outputBullet: bullet,
              },
            );
            return bullet;
          }

          this.logger.warn('hallucinated_metric detected — reverting bullet', {
            experienceIndex: i,
            bulletIndex: j,
            offendingTokens: failingTokens,
            outputBullet: bullet,
            sourceBullet,
          });

          return sourceBullet;
        });
      }
    }
  }

  /**
   * Deterministic skills lock — overwrite optimizedContent.skills with the
   * source skills verbatim. The LLM is instructed to echo skills unchanged,
   * but Class B (technology) hallucinations leak into the skills field too
   * (e.g. injecting JD-only tech, dropping real skills). Logs a structured
   * warning when the LLM diverged from source so we can monitor drift.
   */
  private restoreSourceSkills(
    optimizedContent: TailoredContent,
    sourceContent: TailoredContent,
  ): void {
    const sourceSkills = sourceContent.skills;
    if (!sourceSkills) return;

    const outputSkills = optimizedContent.skills;
    const categories: Array<keyof TailoredContent['skills']> = [
      'languages',
      'frameworks',
      'tools',
      'databases',
      'concepts',
    ];

    const normalize = (s: string): string => s.toLowerCase().trim();
    const added: string[] = [];
    const removed: string[] = [];

    if (outputSkills) {
      for (const category of categories) {
        const sourceSet = new Set(
          (sourceSkills[category] ?? []).map(normalize),
        );
        const outputSet = new Set(
          (outputSkills[category] ?? []).map(normalize),
        );
        for (const token of outputSet) {
          if (!sourceSet.has(token)) added.push(`${category}:${token}`);
        }
        for (const token of sourceSet) {
          if (!outputSet.has(token)) removed.push(`${category}:${token}`);
        }
      }
    }

    if (added.length > 0 || removed.length > 0) {
      this.logger.warn(
        'hallucinated_skills detected — restoring source skills',
        {
          event: 'hallucinated_skills',
          added,
          removed,
        },
      );
    }

    // Deep clone to avoid sharing refs with source content
    optimizedContent.skills = {
      languages: [...(sourceSkills.languages ?? [])],
      frameworks: [...(sourceSkills.frameworks ?? [])],
      tools: [...(sourceSkills.tools ?? [])],
      databases: [...(sourceSkills.databases ?? [])],
      concepts: [...(sourceSkills.concepts ?? [])],
    };

    // Restore skillAliases from source as well. The optimizer's output schema
    // does NOT include skillAliases, so the LLM should not emit them; defensively
    // overwrite any drift with a deep clone of the source aliases.
    if (sourceContent.skillAliases) {
      optimizedContent.skillAliases = sourceContent.skillAliases.map(
        (entry) => ({
          skill: entry.skill,
          alternatives: [...(entry.alternatives ?? [])],
        }),
      );
    } else {
      delete optimizedContent.skillAliases;
    }
  }

  private buildOptimizationPrompt(
    jobAnalysis: JobAnalysisResult,
    candidateContent: TailoredContent,
    companyName: string,
    jobPosition: string,
    verifiedFacts?: VerifiedFact[],
    variant = 'control',
  ): string {
    return this.promptService.getOptimizationPrompt(
      jobAnalysis as unknown as Record<string, unknown>,
      candidateContent as unknown as Record<string, unknown>,
      companyName,
      jobPosition,
      verifiedFacts,
      variant === 'with-rubric',
    );
  }

  /**
   * Optimize resume content using Claude
   */
  private async optimizeWithClaude(
    jobAnalysis: JobAnalysisResult,
    candidateContent: TailoredContent,
    companyName: string,
    jobPosition: string,
    verifiedFacts?: VerifiedFact[],
    variant: string = 'control',
    attempt: number = 1,
  ): Promise<Omit<ResumeOptimizationResult, 'processingMetadata'>> {
    const { system, user } = this.promptService.getOptimizationPromptParts(
      jobAnalysis as unknown as Record<string, unknown>,
      candidateContent as unknown as Record<string, unknown>,
      companyName,
      jobPosition,
      verifiedFacts,
      variant === 'with-rubric',
    );

    const thinkingEnabled =
      this.configService.get<string>('CLAUDE_EXTENDED_THINKING_ENABLED') ===
      'true';

    const response = await this.claudeService.chatCompletion({
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: user }],
      max_tokens: thinkingEnabled
        ? MAX_TOKENS_OPTIMIZATION_WITH_THINKING
        : MAX_TOKENS_OPTIMIZATION,
      // Anthropic requires temperature=1 when extended thinking is enabled
      temperature: thinkingEnabled ? 1 : TEMP_OPTIMIZER,
      promptId: `resume-optimization:${variant}`,
      promptVersion: OPTIMIZATION_PROMPT_VERSION,
      tools: [RETURN_OPTIMIZED_RESUME_TOOL],
      tool_choice: { type: 'tool', name: 'return_optimized_resume' },
      attempt,
      ...(thinkingEnabled && {
        thinking: {
          type: 'enabled' as const,
          budget_tokens: EXTENDED_THINKING_BUDGET_TOKENS,
        },
      }),
    });

    return this.parseOptimizationResponse(response);
  }

  /**
   * Optimize resume content using OpenAI as fallback
   */
  private async optimizeWithOpenAI(
    jobAnalysis: JobAnalysisResult,
    candidateContent: TailoredContent,
    companyName: string,
    jobPosition: string,
    verifiedFacts?: VerifiedFact[],
    variant = 'control',
  ): Promise<Omit<ResumeOptimizationResult, 'processingMetadata'>> {
    const optimizationPrompt = this.buildOptimizationPrompt(
      jobAnalysis,
      candidateContent,
      companyName,
      jobPosition,
      verifiedFacts,
      variant,
    );

    const response = await this.openAIService.chatCompletion({
      model: MODEL_OPTIMIZER_FALLBACK,
      messages: [{ role: 'user', content: optimizationPrompt }],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'resume_optimization',
          strict: true,
          schema: ResumeOptimizationJsonSchema,
        },
      },
      temperature: TEMP_OPTIMIZER,
      max_tokens: MAX_TOKENS_OPTIMIZATION,
      promptId: `resume-optimization-fallback:${variant}`,
      promptVersion: OPTIMIZATION_PROMPT_VERSION,
      fallback_triggered: true,
    });

    // Parse OpenAI response (similar structure to Claude)
    return this.parseOpenAIOptimizationResponse(response);
  }

  /**
   * Parse optimization response from OpenAI
   */
  private parseOpenAIOptimizationResponse(
    response: ChatCompletionResponse,
  ): Omit<ResumeOptimizationResult, 'processingMetadata'> {
    const content = get(head(response.choices), 'message.content');

    if (!content || typeof content !== 'string') {
      throw new InternalServerErrorException(
        'Empty response from OpenAI',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    try {
      const parsedResult = JSON.parse(content) as Record<string, unknown>;
      this.coerceStringifiedFields(parsedResult, 'openai');
      this.validateOptimizationResult(parsedResult);
      return parsedResult as unknown as Omit<
        ResumeOptimizationResult,
        'processingMetadata'
      >;
    } catch (error) {
      this.logger.error('Failed to parse OpenAI optimization response', {
        content: content.substring(0, 500),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new InternalServerErrorException(
        'Failed to parse OpenAI optimization response',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Validate input parameters
   */
  private validateInputs(
    jobAnalysis: JobAnalysisResult,
    candidateContent: TailoredContent,
    companyName: string,
    jobPosition: string,
  ): void {
    if (!jobAnalysis || typeof jobAnalysis !== 'object') {
      throw new BadRequestException(
        'Job analysis is required and must be an object',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    if (!candidateContent || typeof candidateContent !== 'object') {
      throw new BadRequestException(
        'Candidate content is required and must be an object',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    if (!companyName || typeof companyName !== 'string') {
      throw new BadRequestException(
        'Company name is required and must be a string',
        ERROR_CODES.INVALID_COMPANY_NAME,
      );
    }

    if (!jobPosition || typeof jobPosition !== 'string') {
      throw new BadRequestException(
        'Job position is required and must be a string',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate job analysis structure
    if (
      !jobAnalysis.technical ||
      !jobAnalysis.keywords ||
      !jobAnalysis.position
    ) {
      throw new BadRequestException(
        'Invalid job analysis structure',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate candidate content structure
    if (!candidateContent.contactInfo || !candidateContent.experience) {
      throw new BadRequestException(
        'Invalid candidate content structure',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }
}
