import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Logger,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { InitiateQuestionBasedTailoringDto } from '../dtos/initiate-question-based-tailoring.dto';
import { SubmitQuestionResponsesDto } from '../dtos/submit-question-responses.dto';
import { FileValidationPipe } from '../../../shared/pipes/file-validation.pipe';
import { QuestionGenerationService } from '../services/question-generation.service';
import { FactBasedResumeTailoringService } from '../services/fact-based-resume-tailoring.service';
import { Public } from '../../auth/decorators/public.decorator';
import { TransformUserContext } from '../../../shared/decorators/transform-user-context.decorator';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import type { UserContext as ResumeUserContext } from '../interfaces/user-context.interface';
import {
  QuestionBasedTailoringInitiationResponse,
  TailoringSessionDetails,
  QuestionResponsesSubmissionResult,
  FactBasedResumeGenerationResponse,
} from '../interfaces/question-based-tailoring-response.interface';
import { RateLimitFeature } from '../../rate-limit/rate-limit.guard';
import { FeatureType } from '../../../database/entities/usage-tracking.entity';

/**
 * Question-Based Resume Tailoring Controller
 *
 * Implements a 2-step resume tailoring process:
 * 1. Generate targeted questions based on job description and resume
 * 2. Generate fact-based tailored resume using user's question responses
 *
 * This approach eliminates AI hallucination by using only user-provided facts.
 *
 * Key Features:
 * - AI-generated questions targeting business impact
 * - Zero hallucination policy - uses only user facts
 * - Separate endpoints for question generation and resume generation
 * - Progress tracking through session status
 *
 * @version 3.0 - Question-based tailoring
 */
@ApiTags('Resume Tailoring - Question-Based (v3)')
@Controller('resume-tailoring/question-based')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class QuestionBasedResumeTailoringController {
  private readonly logger = new Logger(
    QuestionBasedResumeTailoringController.name,
  );

  constructor(
    private readonly questionGenerationService: QuestionGenerationService,
    private readonly factBasedTailoringService: FactBasedResumeTailoringService,
  ) {}

  /**
   * Step 1: Initiate Question-Based Tailoring
   *
   * Analyzes job description and resume to generate targeted questions
   * about business impact, metrics, and quantifiable achievements.
   *
   * Process:
   * 1. Extract/validate resume content
   * 2. Analyze job requirements
   * 3. Generate 15-25 strategic questions
   * 4. Return questions for user to answer
   *
   * Response Time: ~5-10 seconds (AI question generation)
   */
  @Post('initiate')
  @Public()
  @TransformUserContext()
  @RateLimitFeature(FeatureType.RESUME_GENERATION)
  @UseInterceptors(FileInterceptor('resumeFile'))
  @ApiOperation({
    summary: 'Initiate question-based resume tailoring',
    description:
      'Generate targeted questions about business impact and metrics for resume enhancement',
  })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({
    status: 200,
    description: 'Questions generated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async initiateQuestionBasedTailoring(
    @Body() dto: InitiateQuestionBasedTailoringDto,
    @UploadedFile(FileValidationPipe)
    resumeFile: Express.Multer.File | undefined,
    @Req() request: RequestWithUserContext,
  ): Promise<QuestionBasedTailoringInitiationResponse> {
    const startTime = Date.now();
    const userContext = request.userContext as ResumeUserContext;

    this.logger.log(
      `Initiating question-based tailoring for ${dto.jobPosition} at ${dto.companyName}. ` +
        `User: ${userContext.userId || userContext.guestId}`,
    );

    try {
      const result =
        await this.questionGenerationService.initiateQuestionBasedTailoring({
          userId: userContext.userId,
          guestId: userContext.guestId,
          jobPosition: dto.jobPosition,
          companyName: dto.companyName,
          jobDescription: dto.jobDescription,
          templateId: dto.templateId,
          resumeId: dto.resumeId,
          resumeFile,
        });

      const responseTime = Date.now() - startTime;
      this.logger.log(
        `Questions generated successfully in ${responseTime}ms. ` +
          `Session: ${result.sessionId}, Questions: ${result.questions.length}`,
      );

      return result;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to generate questions after ${processingTime}ms`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get Session Details and Questions
   *
   * Retrieve details of a tailoring session including all generated questions.
   * Useful for users who want to review questions before answering.
   */
  @Get('session/:sessionId')
  @Public()
  @TransformUserContext()
  @ApiOperation({
    summary: 'Get tailoring session details',
    description:
      'Retrieve session information and generated questions for a tailoring session',
  })
  @ApiResponse({
    status: 200,
    description: 'Session details retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getSessionDetails(
    @Param('sessionId') sessionId: string,
    @Req() request: RequestWithUserContext,
  ): Promise<TailoringSessionDetails> {
    const userContext = request.userContext as ResumeUserContext;

    this.logger.debug(
      `Fetching session details for ${sessionId}. User: ${userContext.userId || userContext.guestId}`,
    );

    const session = await this.questionGenerationService.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Verify ownership
    const isOwner =
      (userContext.userId && session.userId === userContext.userId) ||
      (userContext.guestId && session.guestId === userContext.guestId);

    if (!isOwner) {
      throw new Error('Unauthorized access to session');
    }

    const questions =
      await this.questionGenerationService.getSessionQuestions(sessionId);

    return {
      session: {
        id: session.id,
        status: session.status,
        jobPosition: session.jobPosition,
        companyName: session.companyName,
        createdAt: session.createdAt,
      },
      questions: questions.map((q) => ({
        id: q.id,
        workExperienceTitle: `Work Experience ${q.workExperienceIndex + 1}`,
        originalBulletPoint: q.originalBulletPoint,
        questionText: q.questionText,
        questionCategory: q.questionCategory,
        isAnswered: q.isAnswered,
        userResponse: q.userResponse || undefined,
      })),
    };
  }

  /**
   * Step 2: Submit Question Responses
   *
   * User provides answers to the generated questions with factual information
   * about their work experiences, metrics, and business impact.
   *
   * Process:
   * 1. Validate session status
   * 2. Save user responses to database
   * 3. Update session status to 'responses_submitted'
   * 4. Return confirmation
   *
   * Response Time: <1 second
   */
  @Post('submit-responses')
  @Public()
  @TransformUserContext()
  @ApiOperation({
    summary: 'Submit responses to tailoring questions',
    description:
      'Provide factual answers to the generated questions for resume enhancement',
  })
  @ApiResponse({
    status: 200,
    description: 'Responses submitted successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid session or responses' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async submitQuestionResponses(
    @Body() dto: SubmitQuestionResponsesDto,
    @Req() request: RequestWithUserContext,
  ): Promise<QuestionResponsesSubmissionResult> {
    const startTime = Date.now();
    const userContext = request.userContext as ResumeUserContext;

    this.logger.log(
      `Submitting ${dto.responses.length} question responses for session ${dto.sessionId}. ` +
        `User: ${userContext.userId || userContext.guestId}`,
    );

    try {
      // Verify session ownership
      const session = await this.questionGenerationService.getSession(
        dto.sessionId,
      );
      if (!session) {
        throw new Error('Session not found');
      }

      const isOwner =
        (userContext.userId && session.userId === userContext.userId) ||
        (userContext.guestId && session.guestId === userContext.guestId);

      if (!isOwner) {
        throw new Error('Unauthorized access to session');
      }

      const result =
        await this.factBasedTailoringService.submitQuestionResponses(
          dto.sessionId,
          dto.responses,
        );

      const responseTime = Date.now() - startTime;
      this.logger.log(
        `Question responses submitted successfully in ${responseTime}ms. ` +
          `Session: ${result.sessionId}, Answered: ${result.questionsAnswered}`,
      );

      return {
        ...result,
        message:
          'Responses submitted successfully. You can now generate your tailored resume.',
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to submit question responses after ${processingTime}ms`,
        error,
      );
      throw error;
    }
  }

  /**
   * Step 3: Generate Fact-Based Tailored Resume
   *
   * Generates the final tailored resume using ONLY the facts provided
   * by the user in their question responses. Zero AI hallucination.
   *
   * Process:
   * 1. Validate session has responses
   * 2. Generate tailored resume using Claude/GPT-4
   * 3. Incorporate user facts into bullet points
   * 4. Optimize for ATS and keywords
   * 5. Return optimized resume content
   *
   * Response Time: ~30-60 seconds (AI resume generation)
   */
  @Post('generate/:sessionId')
  @Public()
  @TransformUserContext()
  @RateLimitFeature(FeatureType.RESUME_GENERATION)
  @ApiOperation({
    summary: 'Generate fact-based tailored resume',
    description:
      'Create the final tailored resume using user-provided facts from question responses',
  })
  @ApiResponse({
    status: 200,
    description: 'Resume generated successfully with user facts',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid session status or missing responses',
  })
  @ApiResponse({ status: 404, description: 'Session not found' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async generateFactBasedResume(
    @Param('sessionId') sessionId: string,
    @Req() request: RequestWithUserContext,
  ): Promise<FactBasedResumeGenerationResponse> {
    const startTime = Date.now();
    const userContext = request.userContext as ResumeUserContext;

    this.logger.log(
      `Generating fact-based resume for session ${sessionId}. User: ${userContext.userId || userContext.guestId}`,
    );

    try {
      // Verify session ownership
      const session =
        await this.questionGenerationService.getSession(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const isOwner =
        (userContext.userId && session.userId === userContext.userId) ||
        (userContext.guestId && session.guestId === userContext.guestId);

      if (!isOwner) {
        throw new Error('Unauthorized access to session');
      }

      const result =
        await this.factBasedTailoringService.generateFactBasedResume(sessionId);

      const responseTime = Date.now() - startTime;
      this.logger.log(
        `Fact-based resume generated successfully in ${responseTime}ms. ` +
          `Session: ${sessionId}, Keywords: ${result.optimizationMetrics.keywordsAdded}`,
      );

      return {
        sessionId,
        resumeContent: result.optimizedContent,
        enhancementMetrics: {
          bulletPointsEnhanced:
            result.optimizationMetrics.sectionsOptimized || 0,
          metricsAdded: result.optimizationMetrics.achievementsQuantified || 0,
          keywordsIntegrated: result.optimizationMetrics.keywordsAdded || 0,
          userResponsesUsed: 0, // TODO: Track this in the service
          confidenceScore: result.optimizationMetrics.confidenceScore || 90,
        },
        message:
          'Resume generated successfully using your provided facts. No hallucinated data.',
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Failed to generate fact-based resume after ${processingTime}ms`,
        error,
      );
      throw error;
    }
  }
}
