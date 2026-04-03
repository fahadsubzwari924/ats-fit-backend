import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import { AnswerProfileQuestionDto } from '../dtos/answer-profile-question.dto';
import { ProfileQuestionResponseDto } from '../dtos/profile-question-response.dto';
import { ResumeProfileEnrichmentService } from '../services/resume-profile-enrichment.service';
import { ResumeQueueService } from '../services/resume-queue.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TailoringQuestion,
  TailoringQuestionSource,
} from '../../../database/entities/tailoring-session.entity';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { Experience } from '../interfaces/resume-extracted-keywords.interface';
import {
  ForbiddenException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

@ApiTags('Resume Tailoring - Profile Questions (v4)')
@Controller('resume-tailoring/profile-questions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ProfileQuestionsController {
  private readonly logger = new Logger(ProfileQuestionsController.name);

  constructor(
    @InjectRepository(TailoringQuestion)
    private readonly questionRepository: Repository<TailoringQuestion>,
    @InjectRepository(ExtractedResumeContent)
    private readonly extractedResumeContentRepository: Repository<ExtractedResumeContent>,
    private readonly resumeProfileEnrichmentService: ResumeProfileEnrichmentService,
    private readonly resumeQueueService: ResumeQueueService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get all profile questions',
    description:
      'Returns all profile-level questions for the authenticated user with current answer state',
  })
  @ApiResponse({ status: 200, description: 'Profile questions list' })
  async getProfileQuestions(
    @Req() request: RequestWithUserContext,
  ): Promise<ProfileQuestionResponseDto[]> {
    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new ForbiddenException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    const [questions, extractedContent] = await Promise.all([
      this.questionRepository.find({
        where: { userId, source: 'profile' as TailoringQuestionSource },
        order: { orderIndex: 'ASC' },
      }),
      this.extractedResumeContentRepository.findOne({
        where: { userId },
        order: { createdAt: 'DESC' },
      }),
    ]);

    const experiences: Experience[] =
      extractedContent?.structuredContent?.experience ?? [];

    return questions.map(
      (q) =>
        new ProfileQuestionResponseDto(
          q,
          experiences[q.workExperienceIndex] ?? null,
        ),
    );
  }

  @Post('answer')
  @ApiOperation({
    summary: 'Save single profile question answer',
    description:
      'Saves one answer (auto-save on blur). Recalculates completeness; triggers enrichment when all questions are answered.',
  })
  @ApiResponse({ status: 200, description: 'Answer saved' })
  async answerQuestion(
    @Req() request: RequestWithUserContext,
    @Body() dto: AnswerProfileQuestionDto,
  ): Promise<{
    saved: boolean;
    profileCompleteness: number;
    enrichedProfileId: string | null;
  }> {
    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new ForbiddenException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    const question = await this.questionRepository.findOne({
      where: {
        id: dto.questionId,
        userId,
        source: 'profile' as TailoringQuestionSource,
      },
    });
    if (!question) {
      throw new NotFoundException(
        'Profile question not found',
        ERROR_CODES.PROFILE_QUESTION_NOT_FOUND,
      );
    }

    // null = explicit skip ("I don't have this data") → resolved, no text, excluded from enrichment facts
    if (dto.response === null) {
      question.userResponse = null;
      question.isAnswered = true;
    } else {
      const trimmed = (dto.response ?? '').trim();
      question.userResponse = trimmed.length > 0 ? trimmed : null;
      question.isAnswered = trimmed.length > 0;
    }
    await this.questionRepository.save(question);

    await this.resumeProfileEnrichmentService.recalculateCompleteness(userId);

    const all = await this.questionRepository.find({
      where: { userId, source: 'profile' as TailoringQuestionSource },
    });
    const answered = all.filter((q) => q.isAnswered).length;
    const total = all.length;
    const profileCompleteness = total > 0 ? answered / total : 1.0;

    if (total > 0 && answered === total) {
      try {
        await this.resumeQueueService.addProfileEnrichmentJob(userId);
        this.logger.log(
          `Enqueued profile enrichment job for user ${userId} after last question answered`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue profile enrichment job for user ${userId}`,
          err,
        );
      }
    }

    return {
      saved: true,
      profileCompleteness,
      enrichedProfileId: null,
    };
  }

  @Post('complete')
  @ApiOperation({
    summary: 'Mark profile Q&A complete and trigger background enrichment',
    description:
      'User explicitly signals done. Enqueues profile enrichment as a background job. The client should poll GET /users/resume-profile-status until enrichedProfileId is present.',
  })
  @ApiResponse({ status: 200, description: 'Enrichment enqueued' })
  async complete(
    @Req() request: RequestWithUserContext,
  ): Promise<{ enrichedProfileId: string | null }> {
    const userId = request?.userContext?.userId;
    if (!userId) {
      throw new ForbiddenException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    await this.resumeQueueService.addProfileEnrichmentJob(userId);
    this.logger.log(
      `Enqueued profile enrichment job for user ${userId} via /complete`,
    );
    return { enrichedProfileId: null };
  }
}
