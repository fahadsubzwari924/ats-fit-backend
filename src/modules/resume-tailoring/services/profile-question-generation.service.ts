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
 *
 * IMPORTANT: workExperienceIndex and bulletPointIndex are sourced exclusively
 * from the deterministic BulletContext built by ProfileQuestionSelectionService,
 * NOT from the LLM response. The LLM is only responsible for generating question
 * text and category. This prevents index mis-mapping when the LLM re-bases
 * non-contiguous experience indices (e.g. mapping Experience 1 → 0).
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

    const aiQuestions = await this.generateQuestionsWithAI(bulletContexts);
    if (aiQuestions.length === 0) return 0;

    const merged = this.mergeAIQuestionsWithBulletContexts(
      aiQuestions,
      bulletContexts,
    );
    const toSave = merged.slice(0, PROFILE_QUESTION_CAP);
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

  /**
   * Merge LLM-generated question text/category with the authoritative indices
   * from BulletContext. The LLM is prompted to return questions in the same
   * order as the numbered bullets, so we pair by position (index).
   *
   * If the LLM returns fewer questions than bullet contexts, only the returned
   * ones are included. If it returns more, extras are discarded.
   */
  private mergeAIQuestionsWithBulletContexts(
    aiQuestions: AIQuestionFromLLM[],
    bulletContexts: BulletContext[],
  ): ResolvedProfileQuestion[] {
    const count = Math.min(aiQuestions.length, bulletContexts.length);
    const result: ResolvedProfileQuestion[] = [];

    for (let i = 0; i < count; i++) {
      const ctx = bulletContexts[i];
      const q = aiQuestions[i];
      result.push({
        workExperienceIndex: ctx.workExperienceIndex,
        bulletPointIndex: ctx.bulletPointIndex,
        originalBulletPoint: ctx.originalBulletPoint,
        questionText: q.questionText,
        questionCategory: q.questionCategory,
      });
    }

    return result;
  }

  private async generateQuestionsWithAI(
    bulletContexts: BulletContext[],
  ): Promise<AIQuestionFromLLM[]> {
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

  private parseQuestionsResponse(content: string): AIQuestionFromLLM[] {
    try {
      const parsed = JSON.parse(content) as {
        questions?: Record<string, unknown>[];
      };
      const questions = parsed.questions ?? [];
      return questions
        .filter(
          (q) =>
            typeof q.questionText === 'string' &&
            typeof q.questionCategory === 'string',
        )
        .map((q) => ({
          questionText: q.questionText as string,
          questionCategory: q.questionCategory as string,
        }));
    } catch {
      this.logger.warn('Profile question generation returned invalid JSON');
      return [];
    }
  }

  private async persistProfileQuestions(
    userId: string,
    extractedResumeContentId: string,
    questions: ResolvedProfileQuestion[],
  ): Promise<void> {
    const entities = questions.map((q, orderIndex) =>
      this.tailoringQuestionRepository.create({
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
      }),
    );

    if (entities.length > 0) {
      await this.tailoringQuestionRepository.save(entities);
    }
  }
}

/** Only the creative output from the LLM — indices are intentionally excluded. */
interface AIQuestionFromLLM {
  questionText: string;
  questionCategory: string;
}

/** Final question with authoritative indices from BulletContext + LLM-generated text. */
interface ResolvedProfileQuestion {
  workExperienceIndex: number;
  bulletPointIndex: number;
  originalBulletPoint: string;
  questionText: string;
  questionCategory: string;
}
