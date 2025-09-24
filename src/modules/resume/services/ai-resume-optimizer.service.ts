import { Injectable, Logger } from '@nestjs/common';
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
export class AIResumeOptimizerService {
  private readonly logger = new Logger(AIResumeOptimizerService.name);

  constructor(
    private readonly claudeService: ClaudeService,
    private readonly openAIService: OpenAIService,
    private readonly promptService: PromptService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Generate optimized resume content based on job analysis and candidate profile
   *
   * @param jobAnalysis - Comprehensive job analysis result
   * @param candidateContent - Current resume content structure
   * @param companyName - Target company name
   * @param jobPosition - Target job position
   * @returns Promise<ResumeOptimizationResult> - Optimized resume with metrics
   */
  async optimizeResumeContent(
    jobAnalysis: JobAnalysisResult,
    candidateContent: TailoredContent,
    companyName: string,
    jobPosition: string,
  ): Promise<ResumeOptimizationResult> {
    const startTime = Date.now();

    try {
      this.validateInputs(
        jobAnalysis,
        candidateContent,
        companyName,
        jobPosition,
      );

      // Use shared cache for optimization results
      const cacheKeyData = {
        jobSkills: jobAnalysis.technical.mandatorySkills.sort(),
        jobKeywords: jobAnalysis.keywords.primary.sort(),
        position: jobPosition,
        company: companyName,
        experience: candidateContent.experience,
        skills: candidateContent.skills,
        education: candidateContent.education,
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

      // Try Claude first, fallback to OpenAI on overload
      let result: Omit<ResumeOptimizationResult, 'processingMetadata'>;
      let aiModel: string;

      try {
        result = await this.optimizeWithClaude(
          jobAnalysis,
          candidateContent,
          companyName,
          jobPosition,
        );
        aiModel = 'claude-3-5-sonnet-20241022';
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
            candidateContent,
            companyName,
            jobPosition,
          );
          aiModel = 'gpt-4-turbo';
          this.logger.log(
            'Successfully used OpenAI fallback for resume optimization',
          );
        } else {
          // Re-throw non-overload errors
          throw error;
        }
      }
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
      // Extract JSON from response (Claude might include explanatory text)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsedResult = JSON.parse(jsonMatch[0]);
      this.validateOptimizationResult(parsedResult);

      return parsedResult as Omit<
        ResumeOptimizationResult,
        'processingMetadata'
      >;
    } catch (error: any) {
      this.logger.error('Failed to parse optimization response', {
        content: content.substring(0, 500),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        error,
      });
      throw new InternalServerErrorException(
        'Failed to parse optimization response',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Validate the parsed optimization result structure
   */
  private validateOptimizationResult(result: any): void {
    const requiredFields = [
      'optimizedContent',
      'optimizationMetrics',
      'optimizationStrategy',
    ];

    for (const field of requiredFields) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (!result[field]) {
        throw new Error(`Missing required field: ${field}`);
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
        throw new Error(`Missing optimizedContent field: ${field}`);
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
        throw new Error(`Invalid metric field: ${field}`);
      }
    }

    // Validate confidence score range
    if (
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      result.optimizationMetrics.confidenceScore < 0 ||
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      result.optimizationMetrics.confidenceScore > 100
    ) {
      throw new Error('Confidence score must be between 0 and 100');
    }
  }

  /**
   * Optimize resume content using Claude
   */
  private async optimizeWithClaude(
    jobAnalysis: JobAnalysisResult,
    candidateContent: TailoredContent,
    companyName: string,
    jobPosition: string,
  ): Promise<Omit<ResumeOptimizationResult, 'processingMetadata'>> {
    const optimizationPrompt = this.promptService.getResumeOptimizationPrompt(
      jobAnalysis,
      candidateContent,
      companyName,
      jobPosition,
    );

    const response = await this.claudeService.chatCompletion({
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'user',
          content: optimizationPrompt,
        },
      ],
      max_tokens: 3500, // Reduced from 4000 for faster processing
      temperature: 0.2, // Lower temperature for faster, more deterministic output
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
  ): Promise<Omit<ResumeOptimizationResult, 'processingMetadata'>> {
    const optimizationPrompt = this.promptService.getResumeOptimizationPrompt(
      jobAnalysis,
      candidateContent,
      companyName,
      jobPosition,
    );

    const response = await this.openAIService.chatCompletion({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: optimizationPrompt }],
      response_format: { type: 'json_object' },
      temperature: 0.2, // Lower temperature for consistent output
      max_tokens: 3500, // Match Claude's token limit
    });

    // Parse OpenAI response (similar structure to Claude)
    return this.parseOpenAIOptimizationResponse(response);
  }

  /**
   * Check if error is due to Claude being overloaded
   */

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
