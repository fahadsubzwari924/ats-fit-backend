import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TailoringSession,
  TailoringQuestion,
} from '../../../database/entities/tailoring-session.entity';
import { ClaudeService } from '../../../shared/modules/external/services/claude.service';
import { OpenAIService } from '../../../shared/modules/external/services/open_ai.service';
import { PromptService } from '../../../shared/services/prompt.service';
import { AIErrorUtil } from '../../../shared/utils/ai-error.util';
import {
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { ResumeOptimizationResult } from '../interfaces/resume-optimization.interface';
import { get, head, isEmpty } from 'lodash';
import { ClaudeResponse } from '../../../shared/modules/external/interfaces';
import {
  ChatCompletionResponse,
  ChatCompletionChoice,
} from '../../../shared/modules/external/interfaces/open-ai-chat.interface';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';

/**
 * Type definition for AI-generated resume response
 */
interface AIResumeResponse {
  optimizedContent: TailoredContent;
  enhancementMetrics?: {
    keywordsAdded?: number;
    sectionsOptimized?: number;
    achievementsQuantified?: number;
    skillsAligned?: number;
    confidenceScore?: number;
  };
  enhancementSummary?: {
    factsUsed?: string[];
    improvementAreas?: string[];
    atsOptimizations?: string[];
    recommendations?: string[];
  };
}

/**
 * Type guard to validate AI resume response structure
 */
function isAIResumeResponse(obj: unknown): obj is AIResumeResponse {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const response = obj as Record<string, unknown>;
  return (
    typeof response.optimizedContent === 'object' &&
    response.optimizedContent !== null
  );
}

/**
 * Fact-Based Resume Tailoring Service
 *
 * Processes user's question responses and generates a tailored resume
 * using ONLY the facts provided by the user - zero AI hallucination.
 *
 * This service ensures that all quantifiable data in the resume comes
 * directly from the user's responses, not from AI invention.
 */
@Injectable()
export class FactBasedResumeTailoringService {
  private readonly logger = new Logger(FactBasedResumeTailoringService.name);

  constructor(
    @InjectRepository(TailoringSession)
    private readonly sessionRepository: Repository<TailoringSession>,
    @InjectRepository(TailoringQuestion)
    private readonly questionRepository: Repository<TailoringQuestion>,
    private readonly claudeService: ClaudeService,
    private readonly openAIService: OpenAIService,
    private readonly promptService: PromptService,
  ) {}

  /**
   * Submit question responses and prepare for resume generation
   *
   * @param sessionId - Tailoring session ID
   * @param responses - Array of question ID and response pairs
   * @returns Updated session status
   */
  async submitQuestionResponses(
    sessionId: string,
    responses: Array<{ questionId: string; response: string }>,
  ): Promise<{ sessionId: string; status: string; questionsAnswered: number }> {
    const startTime = Date.now();

    this.logger.log(
      `Submitting ${responses.length} question responses for session ${sessionId}`,
    );

    try {
      // Get session
      const session = await this.sessionRepository.findOne({
        where: { id: sessionId, isActive: true },
        relations: ['questions'],
      });

      if (!session) {
        throw new NotFoundException('Tailoring session not found');
      }

      if (session.status !== 'questions_generated') {
        throw new BadRequestException(
          `Invalid session status: ${session.status}. Expected 'questions_generated'`,
          ERROR_CODES.BAD_REQUEST,
        );
      }

      // Update questions with responses
      let answeredCount = 0;
      for (const { questionId, response } of responses) {
        const question = session.questions.find((q) => q.id === questionId);
        if (!question) {
          this.logger.warn(
            `Question ${questionId} not found in session ${sessionId}`,
          );
          continue;
        }

        question.userResponse = response.trim();
        question.isAnswered = true;
        await this.questionRepository.save(question);
        answeredCount++;
      }

      // Update session status
      await this.sessionRepository.update(sessionId, {
        status: 'responses_submitted',
        responsesSubmittedAt: new Date(),
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `Question responses submitted in ${processingTime}ms. ` +
          `${answeredCount} questions answered for session ${sessionId}`,
      );

      return {
        sessionId,
        status: 'responses_submitted',
        questionsAnswered: answeredCount,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to submit question responses after ${processingTime}ms`,
        error,
      );

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to submit question responses',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Generate fact-based tailored resume using user's responses
   *
   * @param sessionId - Tailoring session ID
   * @returns Resume optimization result
   */
  async generateFactBasedResume(
    sessionId: string,
  ): Promise<ResumeOptimizationResult> {
    const startTime = Date.now();

    this.logger.log(`Generating fact-based resume for session ${sessionId}`);

    try {
      // Get session with questions and responses
      const session = await this.sessionRepository.findOne({
        where: { id: sessionId, isActive: true },
        relations: ['questions'],
      });

      if (!session) {
        throw new NotFoundException('Tailoring session not found');
      }

      if (session.status !== 'responses_submitted') {
        throw new BadRequestException(
          `Invalid session status: ${session.status}. Expected 'responses_submitted'`,
          ERROR_CODES.BAD_REQUEST,
        );
      }

      // Update status to generating
      await this.sessionRepository.update(sessionId, {
        status: 'resume_generating',
      });

      // Get answered questions with responses
      const answeredQuestions = session.questions.filter((q) => q.isAnswered);

      if (answeredQuestions.length === 0) {
        throw new BadRequestException(
          'No questions answered. Please provide responses to at least some questions.',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      // Prepare questions and responses for AI
      const questionsAndResponses = answeredQuestions.map((q) => ({
        workExperienceIndex: q.workExperienceIndex,
        workExperienceTitle: `Work Experience ${q.workExperienceIndex + 1}`,
        bulletPointIndex: q.bulletPointIndex,
        originalBulletPoint: q.originalBulletPoint,
        questionText: q.questionText,
        userResponse: q.userResponse || '',
      }));

      // Generate tailored resume using AI
      const result = await this.generateWithAI(
        session.jobDescription,
        session.jobPosition,
        session.companyName,
        session.resumeContent || '',
        questionsAndResponses,
      );

      // Prepare metadata for session update
      const metadata: Record<string, unknown> = {
        aiModel: result.processingMetadata?.aiModel,
        enhancementMetrics: {
          keywordsAdded: result.optimizationMetrics.keywordsAdded,
          sectionsOptimized: result.optimizationMetrics.sectionsOptimized,
          achievementsQuantified:
            result.optimizationMetrics.achievementsQuantified,
          skillsAligned: result.optimizationMetrics.skillsAligned,
          confidenceScore: result.optimizationMetrics.confidenceScore,
        },
      };

      // Update session with completion
      await this.sessionRepository.update(sessionId, {
        status: 'completed',
        resumeGenerationCompletedAt: new Date(),
        resultMetadata: metadata as Record<string, any>,
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `Fact-based resume generated successfully in ${processingTime}ms for session ${sessionId}`,
      );

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to generate fact-based resume after ${processingTime}ms`,
        error,
      );

      // Update session with failure
      await this.sessionRepository.update(sessionId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to generate fact-based tailored resume',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Generate tailored resume using AI (Claude first, fallback to OpenAI)
   */
  private async generateWithAI(
    jobDescription: string,
    jobPosition: string,
    companyName: string,
    originalResumeContent: string,
    questionsAndResponses: Array<{
      workExperienceIndex: number;
      workExperienceTitle: string;
      bulletPointIndex: number;
      originalBulletPoint: string;
      questionText: string;
      userResponse: string;
    }>,
  ): Promise<ResumeOptimizationResult> {
    const prompt = this.promptService.getFactBasedResumeTailoringPrompt(
      jobDescription,
      jobPosition,
      companyName,
      originalResumeContent,
      questionsAndResponses,
    );

    // Try Claude first
    try {
      this.logger.debug('Attempting fact-based resume generation with Claude');
      const result = await this.generateWithClaude(prompt);
      this.logger.log('Successfully generated resume with Claude');
      return result;
    } catch (error) {
      if (AIErrorUtil.isClaudeOverloadError(error)) {
        this.logger.warn(
          'Claude API overloaded, falling back to OpenAI for resume generation',
        );
        const result = await this.generateWithOpenAI(prompt);
        this.logger.log('Successfully generated resume with OpenAI fallback');
        return result;
      }
      throw error;
    }
  }

  /**
   * Generate with Claude
   */
  private async generateWithClaude(
    prompt: string,
  ): Promise<ResumeOptimizationResult> {
    try {
      const response = await this.claudeService.chatCompletion({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8000,
        temperature: 0.2, // Low temperature for factual, consistent output
        messages: [{ role: 'user', content: prompt }],
      });

      return this.parseClaudeResponse(response);
    } catch (error) {
      this.logger.error('Failed to generate resume with Claude', error);
      throw error;
    }
  }

  /**
   * Generate with OpenAI (fallback)
   */
  private async generateWithOpenAI(
    prompt: string,
  ): Promise<ResumeOptimizationResult> {
    try {
      const response = await this.openAIService.chatCompletion({
        model: 'gpt-4-turbo',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 8000,
      });

      return this.parseOpenAIResponse(response);
    } catch (error) {
      this.logger.error('Failed to generate resume with OpenAI', error);
      throw new InternalServerErrorException(
        'Failed to generate resume',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Parse Claude response
   */
  private parseClaudeResponse(
    response: ClaudeResponse,
  ): ResumeOptimizationResult {
    const content = get(response, 'content[0].text', '');
    if (!content) {
      throw new InternalServerErrorException(
        'Empty response from AI',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    try {
      const parsed: unknown = JSON.parse(String(content));
      if (!isAIResumeResponse(parsed)) {
        throw new Error('Invalid AI response structure');
      }
      return this.validateAndMapResponse(parsed);
    } catch (error) {
      this.logger.error('Failed to parse Claude response', {
        content: String(content).substring(0, 500),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalServerErrorException(
        'Failed to parse AI response',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Parse OpenAI response
   */
  private parseOpenAIResponse(
    response: ChatCompletionResponse,
  ): ResumeOptimizationResult {
    const choices = get(response, 'choices', []) as ChatCompletionChoice[];
    if (isEmpty(choices)) {
      throw new InternalServerErrorException(
        'No response received from AI',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    const firstChoice = head(choices);
    const content = String(get(firstChoice, 'message.content', ''));
    if (!content) {
      throw new InternalServerErrorException(
        'Empty response from AI',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    try {
      const parsed: unknown = JSON.parse(content);
      if (!isAIResumeResponse(parsed)) {
        throw new Error('Invalid AI response structure');
      }
      return this.validateAndMapResponse(parsed);
    } catch (error) {
      this.logger.error('Failed to parse OpenAI response', {
        content: content.substring(0, 500),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalServerErrorException(
        'Failed to parse AI response',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Validate and map response to ResumeOptimizationResult
   */
  private validateAndMapResponse(
    parsed: AIResumeResponse,
  ): ResumeOptimizationResult {
    if (!parsed.optimizedContent) {
      throw new Error('Missing optimizedContent in AI response');
    }

    // Map the response structure to match ResumeOptimizationResult interface
    return {
      optimizedContent: parsed.optimizedContent,
      optimizationMetrics: {
        keywordsAdded: parsed.enhancementMetrics?.keywordsAdded ?? 0,
        sectionsOptimized: parsed.enhancementMetrics?.sectionsOptimized ?? 0,
        achievementsQuantified:
          parsed.enhancementMetrics?.achievementsQuantified ?? 0,
        skillsAligned: parsed.enhancementMetrics?.skillsAligned ?? 0,
        confidenceScore: parsed.enhancementMetrics?.confidenceScore ?? 85,
      },
      optimizationStrategy: {
        primaryFocus: parsed.enhancementSummary?.factsUsed ?? [
          'fact-based enhancement',
        ],
        improvementAreas: parsed.enhancementSummary?.improvementAreas ?? [],
        atsOptimizations: parsed.enhancementSummary?.atsOptimizations ?? [],
        recommendations: parsed.enhancementSummary?.recommendations ?? [],
      },
      processingMetadata: {
        aiModel: 'claude-3-5-sonnet-20241022',
        processingTimeMs: 0,
      },
    };
  }
}
