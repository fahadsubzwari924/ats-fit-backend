import { Injectable, Logger } from '@nestjs/common';
import { OpenAIService } from '../../../shared/modules/external/services/open_ai.service';
import { PromptService } from '../../../shared/services/prompt.service';
import { JobAnalysisResult } from '../interfaces/job-analysis.interface';
import {
  InternalServerErrorException,
  BadRequestException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { get, head, isEmpty } from 'lodash';
import {
  ChatCompletionChoice,
  ChatCompletionResponse,
} from '../../../shared/modules/external/interfaces/open-ai-chat.interface';

/**
 * Job Description Analysis Service V2
 *
 * Uses GPT-4 Turbo for comprehensive job description analysis and keyword extraction.
 * This service focuses solely on understanding job requirements without any resume comparison.
 *
 * Key improvements over V1:
 * - More comprehensive job analysis
 * - Better keyword categorization for ATS optimization
 * - Context awareness for tailoring strategy
 * - Enhanced error handling and validation
 */
@Injectable()
export class JobDescriptionAnalysisService {
  private readonly logger = new Logger(JobDescriptionAnalysisService.name);

  constructor(
    private readonly openAIService: OpenAIService,
    private readonly promptService: PromptService,
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

    try {
      this.validateInputs(jobDescription, jobPosition, companyName);

      this.logger.log(
        `Starting job description analysis for position: ${jobPosition} at ${companyName}`,
      );

      const analysisPrompt = this.promptService.getJobDescriptionAnalysisPrompt(
        jobDescription,
        jobPosition,
        companyName,
      );

      const response = await this.openAIService.chatCompletion({
        model: 'gpt-4-turbo',
        messages: [{ role: 'user', content: analysisPrompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1, // Low temperature for consistent analysis
        max_tokens: 4000, // Sufficient for comprehensive analysis
      });

      const result = this.parseAnalysisResponse(response);
      this.logger.log(
        `Job description analysis response parsed successfully: ${JSON.stringify(result)}`,
      );
      const processingTime = Date.now() - startTime;

      this.logger.log(
        `Job analysis completed in ${processingTime}ms. Extracted ${result.technical.mandatorySkills.length} mandatory skills and ${result.keywords.primary.length} primary keywords`,
      );

      return {
        ...result,
        metadata: {
          ...result.metadata,
          processedAt: new Date(),
        },
      };
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
      this.validateAnalysisResult(parsedResult);
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
   * Validate the parsed analysis result structure
   */
  private validateAnalysisResult(result: unknown): void {
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid result: must be an object');
    }

    const resultObj = result as Record<string, unknown>;
    const requiredFields = [
      'position',
      'technical',
      'experience',
      'qualifications',
      'context',
      'keywords',
      'metadata',
    ];

    for (const field of requiredFields) {
      if (!resultObj[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate position level
    const validLevels = [
      'entry',
      'junior',
      'mid',
      'senior',
      'lead',
      'principal',
      'director',
    ];

    const position = resultObj.position as Record<string, unknown>;
    const level = position?.level;

    if (!level || typeof level !== 'string' || !validLevels.includes(level)) {
      const levelStr = typeof level === 'string' ? level : 'unknown';
      throw new Error(`Invalid position level: ${levelStr}`);
    }

    // Validate metadata scores
    const metadata = resultObj.metadata as Record<string, unknown>;
    const confidenceScore = metadata?.confidenceScore;

    if (
      typeof confidenceScore !== 'number' ||
      confidenceScore < 0 ||
      confidenceScore > 100
    ) {
      throw new Error('Invalid confidence score');
    }
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
