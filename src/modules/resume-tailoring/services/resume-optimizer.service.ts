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
import {
  OPTIMIZATION_PROMPT_VERSION,
} from '../../../shared/constants/prompt-versions.constants';
import { RETURN_OPTIMIZED_RESUME_TOOL } from '../types/claude-tools';

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
      const rankedCandidateContent: TailoredContent = {
        ...candidateContent,
        experience: candidateContent.experience.map((exp, idx) => ({
          ...exp,
          responsibilities: rankedBullets[idx]?.bullets ?? exp.responsibilities,
          achievements: [],
        })),
      };

      // Try Claude first, fallback to OpenAI on overload
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
        );
        aiModel = this.claudeService.defaultModel;
        this.logger.log('Successfully used Claude for resume optimization');
      } catch (error) {
        this.logger.debug(
          `Claude optimization failed, checking if overload error: ${JSON.stringify(
            {
              message: error instanceof Error ? error.message : 'Unknown error',
              type: typeof error,
              isOverload: AIErrorUtil.isClaudeOverloadError(error),
            },
          )}`,
        );

        if (AIErrorUtil.isClaudeOverloadError(error)) {
          this.logger.warn(
            'Claude API overloaded, falling back to OpenAI for resume optimization',
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
            'Successfully used OpenAI fallback for resume optimization',
          );
        } else {
          // Re-throw non-overload errors
          throw error;
        }
      }

      result.optimizedContent.summary = this.sanitizeSummary(
        result.optimizedContent.summary,
      );

      this.scrubInventedMetrics(
        result.optimizedContent,
        rankedCandidateContent,
        verifiedFacts ?? [],
      );

      // Post-LLM validation: ensure no experience or bullet was silently dropped
      this.validateNoExperienceDropped(
        rankedCandidateContent,
        result.optimizedContent,
      );

      const processingTime = Date.now() - startTime;

      this.logger.log(
        `Resume optimization completed in ${processingTime}ms. Added ${result.optimizationMetrics.keywordsAdded} keywords, optimized ${result.optimizationMetrics.sectionsOptimized} sections`,
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsedResult = JSON.parse(content) as unknown;
      this.validateOptimizationResult(parsedResult);

      return parsedResult as Omit<
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

  /**
   * Validate the parsed optimization result structure
   */
  private validateOptimizationResult(result: any): void {
    const requiredFields = ['optimizedContent', 'optimizationMetrics'];

    for (const field of requiredFields) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!result[field]) {
        throw new InternalServerErrorException(
          `Missing required field in AI response: ${field}`,
          ERROR_CODES.MISSING_REQUIRED_AI_FIELD,
        );
      }
    }

    // Validate optimizedContent structure
    const contentFields = [
      'title',
      'contactInfo',
      'summary',
      'skills',
      'experience',
      'education',
      'certifications',
    ];

    for (const field of contentFields) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (result.optimizedContent[field] === undefined) {
        throw new InternalServerErrorException(
          `Missing required field in AI response: optimizedContent.${field}`,
          ERROR_CODES.MISSING_REQUIRED_AI_FIELD,
        );
      }
    }

    // Validate metrics
    const metricsFields = [
      'keywordsAdded',
      'sectionsOptimized',
      'achievementsQuantified',
      'skillsAligned',
      'confidenceScore',
    ];

    for (const field of metricsFields) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (typeof result.optimizationMetrics[field] !== 'number') {
        throw new BadRequestException(
          `Invalid metric field: ${field}`,
          ERROR_CODES.INVALID_METRIC_FIELD,
        );
      }
    }

    if (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      result.optimizationMetrics.confidenceScore < 0 ||
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      result.optimizationMetrics.confidenceScore > 100
    ) {
      throw new BadRequestException(
        'Invalid confidence score',
        ERROR_CODES.INVALID_CONFIDENCE_SCORE,
      );
    }
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
        ERROR_CODES.AI_RESPONSE_PARSING_FAILED,
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
  ): void {
    const verifiedText = verifiedFacts.map((f) => f.userResponse).join('\n');

    for (let i = 0; i < optimizedContent.experience.length; i++) {
      const outputExp = optimizedContent.experience[i];
      const sourceExp = sourceContent.experience[i];

      for (const field of ['responsibilities', 'achievements'] as const) {
        const outputBullets = outputExp[field] ?? [];
        const sourceBullets = sourceExp?.[field] ?? [];

        outputExp[field] = outputBullets
          .map((bullet, j) => {
            const tokens = bullet.match(/\d+[%xkK]?|\$[\d,]+/g) ?? [];
            if (tokens.length === 0) return bullet;

            const sourceBullet = sourceBullets[j] ?? '';
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

            this.logger.warn(
              'hallucinated_metric detected — reverting bullet',
              {
                experienceIndex: i,
                bulletIndex: j,
                offendingTokens: failingTokens,
                outputBullet: bullet,
                sourceBullet,
              },
            );

            return sourceBullet;
          });
      }
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
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
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
      const parsedResult: unknown = JSON.parse(content);
      this.validateOptimizationResult(parsedResult);
      return parsedResult as Omit<
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
