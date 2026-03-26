import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  TailoringQuestion,
  TailoringQuestionSource,
} from '../../../database/entities/tailoring-session.entity';
import { PromptService } from '../../../shared/services/prompt.service';
import { OpenAIService } from '../../../shared/modules/external/services/open_ai.service';
import { Experience } from '../interfaces/resume-extracted-keywords.interface';
import {
  ProfileQuestionSelectionService,
  BulletContext,
} from './profile-question-selection.service';

const PROFILE_QUESTION_CAP = 12;

/**
 * Profile Question Generation Service
 *
 * Single responsibility: generate profile-level questions via AI and persist
 * them as TailoringQuestion rows (source=profile). Used by the resume extraction
 * pipeline after structured content is available.
 */
@Injectable()
export class ProfileQuestionGenerationService {
  private readonly logger = new Logger(ProfileQuestionGenerationService.name);

  constructor(
    @InjectRepository(TailoringQuestion)
    private readonly tailoringQuestionRepository: Repository<TailoringQuestion>,
    private readonly profileQuestionSelectionService: ProfileQuestionSelectionService,
    private readonly promptService: PromptService,
    private readonly openAIService: OpenAIService,
  ) {}

  /**
   * Generate questions for selected bullets and save as profile questions.
   * Returns the number of questions saved. Does not throw; returns 0 on failure.
   */
  async generateAndSaveProfileQuestions(
    userId: string,
    extractedResumeContentId: string,
    structuredContent: { experience?: Experience[] },
  ): Promise<number> {
    if (!userId || !extractedResumeContentId) {
      this.logger.warn(
        'generateAndSaveProfileQuestions called with missing userId or extractedResumeContentId — skipping',
      );
      return 0;
    }
    const experiences = structuredContent.experience ?? [];
    if (experiences.length === 0) return 0;

    const selectedExperiences =
      this.profileQuestionSelectionService.selectExperiencesForQuestions(
        experiences,
      );
    if (selectedExperiences.length === 0) return 0;

    const bulletContexts =
      this.profileQuestionSelectionService.buildBulletContexts(
        experiences,
        selectedExperiences,
      );
    if (bulletContexts.length === 0) return 0;

    const questions = await this.generateQuestionsWithAI(bulletContexts);
    if (questions.length === 0) return 0;

    const toSave = questions.slice(0, PROFILE_QUESTION_CAP);
    await this.persistProfileQuestions(
      userId,
      extractedResumeContentId,
      toSave,
    );

    this.logger.log(
      `Profile questions ready: userId=${userId}, questionsTotal=${toSave.length}, processingId=${extractedResumeContentId}`,
      {
        userId,
        questionsTotal: toSave.length,
        processingId: extractedResumeContentId,
      },
    );
    return toSave.length;
  }

  private async generateQuestionsWithAI(
    bulletContexts: BulletContext[],
  ): Promise<AIGeneratedQuestion[]> {
    const prompt =
      this.promptService.getProfileQuestionGenerationPrompt(bulletContexts);

    const response = await this.openAIService.chatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return [];

    return this.parseQuestionsResponse(content);
  }

  private parseQuestionsResponse(content: string): AIGeneratedQuestion[] {
    try {
      const parsed = JSON.parse(content) as {
        questions?: AIGeneratedQuestion[];
      };
      const questions = parsed.questions ?? [];
      return questions.filter(
        (q) =>
          typeof q.workExperienceIndex === 'number' &&
          typeof q.bulletPointIndex === 'number' &&
          typeof q.originalBulletPoint === 'string' &&
          typeof q.questionText === 'string' &&
          typeof q.questionCategory === 'string',
      );
    } catch {
      this.logger.warn('Profile question generation returned invalid JSON');
      return [];
    }
  }

  private async persistProfileQuestions(
    userId: string,
    extractedResumeContentId: string,
    questions: AIGeneratedQuestion[],
  ): Promise<void> {
    for (let orderIndex = 0; orderIndex < questions.length; orderIndex++) {
      const q = questions[orderIndex];
      const entity = this.tailoringQuestionRepository.create({
        userId,
        extractedResumeContentId,
        source: 'profile' as TailoringQuestionSource,
        workExperienceIndex: q.workExperienceIndex,
        bulletPointIndex: q.bulletPointIndex,
        originalBulletPoint: q.originalBulletPoint,
        questionText: q.questionText,
        questionCategory: q.questionCategory,
        orderIndex,
        isAnswered: false,
      });
      await this.tailoringQuestionRepository.save(entity);
    }
  }
}

interface AIGeneratedQuestion {
  workExperienceIndex: number;
  bulletPointIndex: number;
  originalBulletPoint: string;
  questionText: string;
  questionCategory: string;
}
