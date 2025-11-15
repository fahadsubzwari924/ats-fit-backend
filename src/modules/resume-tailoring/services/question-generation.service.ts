import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TailoringSession,
  TailoringQuestion,
} from '../../../database/entities/tailoring-session.entity';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { OpenAIService } from '../../../shared/modules/external/services/open_ai.service';
import { ClaudeService } from '../../../shared/modules/external/services/claude.service';
import { PromptService } from '../../../shared/services/prompt.service';
import { ResumeService } from './resume.service';
import {
  QuestionBasedTailoringInitiationResponse,
  AIQuestionGenerationResponse,
} from '../interfaces/question-based-tailoring-response.interface';
import {
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { get, head, isEmpty } from 'lodash';
import {
  ChatCompletionResponse,
  ChatCompletionChoice,
} from '../../../shared/modules/external/interfaces/open-ai-chat.interface';
import * as pdf from 'pdf-parse';

/**
 * Question Generation Service
 *
 * Handles the question-based resume tailoring process:
 * 1. Analyze resume and job description
 * 2. Generate targeted questions for business impact
 * 3. Store questions in database
 * 4. Process user responses
 * 5. Generate fact-based tailored resume
 *
 * This service ensures zero AI hallucination by basing all
 * resume enhancements on user-provided facts only.
 */
@Injectable()
export class QuestionGenerationService {
  private readonly logger = new Logger(QuestionGenerationService.name);

  constructor(
    @InjectRepository(TailoringSession)
    private readonly sessionRepository: Repository<TailoringSession>,
    @InjectRepository(TailoringQuestion)
    private readonly questionRepository: Repository<TailoringQuestion>,
    @InjectRepository(ExtractedResumeContent)
    private readonly extractedResumeRepository: Repository<ExtractedResumeContent>,
    private readonly openAIService: OpenAIService,
    private readonly claudeService: ClaudeService,
    private readonly promptService: PromptService,
    private readonly resumeService: ResumeService,
  ) {}

  /**
   * Initiate question-based tailoring session
   * Analyzes resume and job description, generates questions
   *
   * @param userId - User ID (optional for guest users)
   * @param guestId - Guest ID (optional for registered users)
   * @param jobPosition - Target job position
   * @param companyName - Target company name
   * @param jobDescription - Complete job description
   * @param templateId - Resume template ID
   * @param resumeId - Existing resume ID (optional)
   * @param resumeFile - Uploaded resume file (optional)
   * @returns Session with generated questions
   */
  async initiateQuestionBasedTailoring(input: {
    userId?: string;
    guestId?: string;
    jobPosition: string;
    companyName: string;
    jobDescription: string;
    templateId: string;
    resumeId?: string;
    resumeFile?: Express.Multer.File;
  }): Promise<QuestionBasedTailoringInitiationResponse> {
    const startTime = Date.now();
    const {
      userId,
      guestId,
      jobPosition,
      companyName,
      jobDescription,
      templateId,
      resumeId,
      resumeFile,
    } = input;

    this.logger.log(
      `Initiating question-based tailoring for ${jobPosition} at ${companyName}`,
    );

    try {
      // Step 1: Get or extract resume content
      let resumeContent: string;
      let resumeFileName: string | undefined;
      let resumeFileSize: number | undefined;
      let actualResumeId: string | undefined = resumeId;

      if (resumeFile) {
        // Guest user with uploaded file
        this.logger.debug('Processing uploaded resume file');
        resumeContent = await this.extractTextFromFile(resumeFile);
        resumeFileName = resumeFile.originalname;
        resumeFileSize = resumeFile.size;
      } else if (resumeId) {
        // Registered user with existing extracted resume
        this.logger.debug(`Fetching existing resume: ${resumeId}`);
        const extractedResume = await this.extractedResumeRepository.findOne({
          where: { id: resumeId },
        });
        if (!extractedResume) {
          throw new NotFoundException('Resume not found');
        }
        resumeContent = extractedResume.extractedText;
        actualResumeId = resumeId;
      } else if (userId) {
        // Registered user - get latest extracted resume
        this.logger.debug(`Fetching latest resume for user: ${userId}`);
        const latestResume = await this.extractedResumeRepository.findOne({
          where: { userId },
          order: { createdAt: 'DESC' },
        });
        if (!latestResume) {
          throw new BadRequestException(
            'No resume found. Please upload a resume.',
            ERROR_CODES.RESUME_NOT_FOUND,
          );
        }
        resumeContent = latestResume.extractedText;
        actualResumeId = latestResume.id;
      } else {
        throw new BadRequestException(
          'Resume file is required for guest users',
          ERROR_CODES.RESUME_FILE_REQUIRED,
        );
      }

      if (!resumeContent || resumeContent.trim().length < 100) {
        throw new BadRequestException(
          'Resume content is too short or invalid',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      // Step 2: Create tailoring session
      const session = this.sessionRepository.create({
        userId,
        guestId,
        resumeId: actualResumeId,
        jobPosition,
        companyName,
        jobDescription,
        templateId,
        status: 'created',
        resumeFileName,
        resumeFileSize,
        resumeContent,
      });

      const savedSession = await this.sessionRepository.save(session);
      this.logger.debug(`Created tailoring session: ${savedSession.id}`);

      // Step 3: Generate questions using AI
      const questionGenerationResult = await this.generateQuestions(
        jobDescription,
        jobPosition,
        companyName,
        resumeContent,
      );

      // Step 4: Save questions to database
      const questions: TailoringQuestion[] = [];
      let orderIndex = 0;

      for (const q of questionGenerationResult.questions) {
        const question = this.questionRepository.create({
          sessionId: savedSession.id,
          workExperienceIndex: q.workExperienceIndex,
          bulletPointIndex: q.bulletPointIndex,
          originalBulletPoint: q.originalBulletPoint,
          questionText: q.questionText,
          questionCategory: q.questionCategory,
          orderIndex: orderIndex++,
          isAnswered: false,
        });
        questions.push(question);
      }

      const savedQuestions = await this.questionRepository.save(questions);

      // Step 5: Update session status
      await this.sessionRepository.update(savedSession.id, {
        status: 'questions_generated',
        questionsGeneratedAt: new Date(),
      });

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `Question generation completed in ${processingTime}ms. Generated ${savedQuestions.length} questions for session ${savedSession.id}`,
      );

      // Step 6: Return formatted response
      return {
        sessionId: savedSession.id,
        questions: savedQuestions.map((q) => ({
          id: q.id,
          workExperienceTitle:
            questionGenerationResult.questions.find(
              (qr) =>
                qr.workExperienceIndex === q.workExperienceIndex &&
                qr.bulletPointIndex === q.bulletPointIndex,
            )?.workExperienceTitle || 'Work Experience',
          workExperienceIndex: q.workExperienceIndex,
          bulletPointIndex: q.bulletPointIndex,
          originalBulletPoint: q.originalBulletPoint,
          questionText: q.questionText,
          questionCategory: q.questionCategory,
        })),
        analysis: questionGenerationResult.analysis,
        recommendations: questionGenerationResult.recommendations,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Question generation failed after ${processingTime}ms`,
        error,
      );

      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to generate questions for resume tailoring',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Generate questions using AI (GPT-4 Turbo)
   */
  private async generateQuestions(
    jobDescription: string,
    jobPosition: string,
    companyName: string,
    resumeContent: string,
  ): Promise<AIQuestionGenerationResponse> {
    const prompt = this.promptService.getQuestionGenerationPrompt(
      jobDescription,
      jobPosition,
      companyName,
      resumeContent,
    );

    try {
      const response = await this.openAIService.chatCompletion({
        model: 'gpt-4-turbo',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3, // Balanced for creative yet consistent questions
        max_tokens: 4000,
      });

      return this.parseQuestionGenerationResponse(response);
    } catch (error) {
      this.logger.error('Failed to generate questions with OpenAI', error);
      throw new InternalServerErrorException(
        'Failed to generate tailoring questions',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Extract text from uploaded PDF file
   */
  private async extractTextFromFile(
    resumeFile: Express.Multer.File,
  ): Promise<string> {
    try {
      const pdfData = await pdf(resumeFile.buffer);
      const text = pdfData.text.trim();

      if (!text || text.length < 100) {
        throw new BadRequestException(
          'Resume file appears to be empty or contains insufficient text',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      return text;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        'Failed to extract text from resume file. Please ensure the file is a valid PDF.',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Parse and validate question generation response
   */
  private parseQuestionGenerationResponse(
    response: ChatCompletionResponse,
  ): AIQuestionGenerationResponse {
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
      const parsed = JSON.parse(content) as AIQuestionGenerationResponse;

      if (!parsed.questions || !Array.isArray(parsed.questions)) {
        throw new Error('Invalid response structure: missing questions array');
      }

      if (!parsed.analysis || typeof parsed.analysis !== 'object') {
        throw new Error('Invalid response structure: missing analysis object');
      }

      return parsed;
    } catch (error) {
      this.logger.error('Failed to parse question generation response', {
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
   * Get tailoring session by ID
   */
  async getSession(sessionId: string): Promise<TailoringSession | null> {
    return this.sessionRepository.findOne({
      where: { id: sessionId, isActive: true },
      relations: ['questions'],
    });
  }

  /**
   * Get session questions
   */
  async getSessionQuestions(sessionId: string): Promise<TailoringQuestion[]> {
    return this.questionRepository.find({
      where: { sessionId },
      order: { orderIndex: 'ASC' },
    });
  }
}
