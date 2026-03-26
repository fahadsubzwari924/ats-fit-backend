import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnrichedResumeProfile } from '../../../database/entities/enriched-resume-profile.entity';
import {
  TailoringQuestion,
  TailoringQuestionSource,
} from '../../../database/entities/tailoring-session.entity';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { ClaudeService } from '../../../shared/modules/external/services/claude.service';
import { PromptService } from '../../../shared/services/prompt.service';
import { AIErrorUtil } from '../../../shared/utils/ai-error.util';
import {
  NotFoundException,
  InternalServerErrorException,
  ForbiddenException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { get } from 'lodash';
import { ClaudeResponse } from '../../../shared/modules/external/interfaces';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import { AIResumeResponse } from '../interfaces/resume-optimization.interface';
import {
  ResumeProfileStatusResponse,
  ProcessingStatus,
  TailoringMode,
} from '../interfaces/resume-profile-enrichment.interface';
import {
  VerifiedFact,
  TailoringModeResult,
} from '../interfaces/user-context.interface';
import { QueueMessageStatus } from '../../../shared/enums/queue-message.enum';

function isAIResumeResponse(obj: unknown): obj is AIResumeResponse {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  return typeof r.optimizedContent === 'object' && r.optimizedContent !== null;
}

/**
 * Resume Profile Enrichment Service
 *
 * Merges answered profile-level TailoringQuestion responses with original
 * structuredContent into an EnrichedResumeProfile via Claude. Used as the
 * base content for all future resume tailoring.
 */
@Injectable()
export class ResumeProfileEnrichmentService {
  private readonly logger = new Logger(ResumeProfileEnrichmentService.name);

  constructor(
    @InjectRepository(EnrichedResumeProfile)
    private readonly enrichedProfileRepository: Repository<EnrichedResumeProfile>,
    @InjectRepository(TailoringQuestion)
    private readonly questionRepository: Repository<TailoringQuestion>,
    @InjectRepository(ExtractedResumeContent)
    private readonly extractedResumeRepository: Repository<ExtractedResumeContent>,
    private readonly claudeService: ClaudeService,
    private readonly promptService: PromptService,
  ) {}

  /**
   * Merge answered profile questions into structured content and save/update EnrichedResumeProfile.
   */
  async enrichProfile(userId: string): Promise<EnrichedResumeProfile> {
    const profileQuestions = await this.questionRepository.find({
      where: { userId, source: 'profile' as TailoringQuestionSource },
      order: { orderIndex: 'ASC' },
    });
    if (profileQuestions.length === 0) {
      throw new NotFoundException(
        'No profile questions found for user',
        ERROR_CODES.PROFILE_ENRICHMENT_NOT_FOUND,
      );
    }

    const extractedResumeContentId =
      profileQuestions[0].extractedResumeContentId;
    if (!extractedResumeContentId) {
      throw new NotFoundException(
        'Profile questions not linked to extracted resume',
        ERROR_CODES.PROFILE_ENRICHMENT_NOT_FOUND,
      );
    }

    const extracted = await this.extractedResumeRepository.findOne({
      where: { id: extractedResumeContentId, userId },
    });
    if (!extracted) {
      throw new NotFoundException(
        'Extracted resume content not found',
        ERROR_CODES.PROFILE_ENRICHMENT_NOT_FOUND,
      );
    }

    const originalContent = extracted.structuredContent;
    const questionsAndResponses = profileQuestions
      .filter((q) => q.isAnswered && q.userResponse?.trim())
      .map((q) => ({
        workExperienceIndex: q.workExperienceIndex,
        bulletPointIndex: q.bulletPointIndex,
        originalBulletPoint: q.originalBulletPoint,
        questionText: q.questionText,
        userResponse: (q.userResponse ?? '').trim(),
      }));

    const prompt = this.promptService.getProfileEnrichmentPrompt(
      JSON.stringify(originalContent),
      questionsAndResponses,
    );

    let enrichedContent: TailoredContent;
    try {
      const response = await this.claudeService.chatCompletion({
        max_tokens: 8000,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      });
      enrichedContent = this.parseEnrichmentResponse(response);
    } catch (error) {
      if (AIErrorUtil.isClaudeOverloadError(error)) {
        this.logger.warn('Claude overload during profile enrichment', error);
      }
      throw new InternalServerErrorException(
        'Profile enrichment failed',
        ERROR_CODES.PROFILE_ENRICHMENT_FAILED,
      );
    }

    const answeredCount = profileQuestions.filter((q) => q.isAnswered).length;
    const totalCount = profileQuestions.length;
    const profileCompleteness =
      totalCount > 0 ? answeredCount / totalCount : 1.0;

    const existing = await this.enrichedProfileRepository.findOne({
      where: { userId, extractedResumeContentId },
    });

    if (existing) {
      existing.enrichedContent = enrichedContent;
      existing.originalContent = originalContent;
      existing.profileCompleteness = profileCompleteness;
      existing.questionsTotal = totalCount;
      existing.questionsAnswered = answeredCount;
      existing.version += 1;
      existing.lastEnrichedAt = new Date();
      await this.enrichedProfileRepository.save(existing);
      this.logger.log(
        `Updated EnrichedResumeProfile ${existing.id} for user ${userId}`,
      );
      return existing;
    }

    const created = this.enrichedProfileRepository.create({
      userId,
      extractedResumeContentId,
      enrichedContent,
      originalContent,
      profileCompleteness,
      questionsTotal: totalCount,
      questionsAnswered: answeredCount,
      version: 1,
      lastEnrichedAt: new Date(),
    });
    await this.enrichedProfileRepository.save(created);
    this.logger.log(
      `Created EnrichedResumeProfile ${created.id} for user ${userId}`,
    );
    return created;
  }

  private parseEnrichmentResponse(response: ClaudeResponse): TailoredContent {
    const raw = String(get(response, 'choices[0].message.content', ''));
    const content = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    if (!content) {
      this.logger.error('Empty AI response for profile enrichment', {
        rawLength: raw.length,
        responseKeys: Object.keys(response),
      });
      throw new InternalServerErrorException(
        'Empty AI response',
        ERROR_CODES.PROFILE_ENRICHMENT_FAILED,
      );
    }
    try {
      const parsed: unknown = JSON.parse(content);
      if (!isAIResumeResponse(parsed)) {
        throw new InternalServerErrorException(
          'Invalid enrichment response structure',
          ERROR_CODES.INVALID_AI_RESPONSE_STRUCTURE,
        );
      }
      return parsed.optimizedContent;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      this.logger.error('Failed to parse profile enrichment response', {
        contentPreview: content.substring(0, 500),
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalServerErrorException(
        'Failed to parse profile enrichment response',
        ERROR_CODES.AI_RESPONSE_PARSING_FAILED,
      );
    }
  }

  /**
   * Get existing enriched profile for user (by user id, latest by extracted content).
   */
  async getProfileForUser(
    userId: string,
  ): Promise<EnrichedResumeProfile | null> {
    if (!userId) return null;
    return this.enrichedProfileRepository.findOne({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
  }

  /**
   * Get enriched profile for user and extracted content.
   */
  async getProfile(
    userId: string,
    extractedResumeContentId: string,
  ): Promise<EnrichedResumeProfile | null> {
    if (!userId || !extractedResumeContentId) return null;
    return this.enrichedProfileRepository.findOne({
      where: { userId, extractedResumeContentId },
    });
  }

  /**
   * Answered profile questions with non-empty responses for the given resume.
   * Used as source-of-truth facts during precision resume optimization.
   */
  async getAnsweredProfileFacts(
    userId: string,
    extractedResumeContentId: string,
  ): Promise<VerifiedFact[]> {
    if (!userId || !extractedResumeContentId) return [];

    const rows = await this.questionRepository.find({
      where: {
        userId,
        extractedResumeContentId,
        source: 'profile' as TailoringQuestionSource,
        isAnswered: true,
      },
      order: { orderIndex: 'ASC' },
    });

    return rows
      .filter((q) => (q.userResponse ?? '').trim().length > 0)
      .map((q) => ({
        originalBulletPoint: q.originalBulletPoint ?? '',
        userResponse: (q.userResponse ?? '').trim(),
      }));
  }

  /**
   * Profile Q&A facts and tailoring mode for a specific extracted resume (not global user scope).
   * Drives ResumeContentProcessorService so partial answers always reach the optimizer.
   */
  async resolveTailoringContextForResume(
    userId: string,
    extractedResumeContentId: string,
  ): Promise<{
    verifiedFacts: VerifiedFact[];
    tailoringMode: TailoringModeResult;
  }> {
    if (!userId || !extractedResumeContentId) {
      return { verifiedFacts: [], tailoringMode: 'standard' };
    }

    const verifiedFacts = await this.getAnsweredProfileFacts(
      userId,
      extractedResumeContentId,
    );

    const profileQuestions = await this.questionRepository.find({
      where: {
        userId,
        extractedResumeContentId,
        source: 'profile' as TailoringQuestionSource,
      },
    });

    const questionsTotal = profileQuestions.length;
    const questionsAnswered = profileQuestions.filter((q) => q.isAnswered)
      .length;
    const profileCompleteness =
      questionsTotal > 0 ? questionsAnswered / questionsTotal : 1.0;

    let tailoringMode: TailoringModeResult = 'standard';
    if (questionsTotal === 0) {
      tailoringMode = 'standard';
    } else if (profileCompleteness >= 1.0) {
      tailoringMode = 'precision';
    } else if (questionsAnswered > 0) {
      tailoringMode = 'enhanced';
    }

    return { verifiedFacts, tailoringMode };
  }

  /**
   * Get resume profile status for polling after upload (tailoring mode, completeness, etc.).
   */
  async getResumeProfileStatus(
    userId: string,
  ): Promise<ResumeProfileStatusResponse> {
    if (!userId) {
      throw new ForbiddenException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }
    const latestExtracted = await this.extractedResumeRepository.findOne({
      where: { userId },
      relations: ['queueMessage'],
      order: { createdAt: 'DESC' },
    });

    if (!latestExtracted) {
      return {
        hasResume: false,
        processingStatus: 'none',
        questionsTotal: 0,
        questionsAnswered: 0,
        profileCompleteness: 0,
        enrichedProfileId: null,
        tailoringMode: 'none',
      };
    }

    const queueStatus = latestExtracted.queueMessage?.status;
    const processingStatus = this.mapQueueStatusToProcessingStatus(queueStatus);

    const profileQuestions = await this.questionRepository.find({
      where: { userId, source: 'profile' as TailoringQuestionSource },
    });
    const questionsTotal = profileQuestions.length;
    const questionsAnswered = profileQuestions.filter(
      (q) => q.isAnswered,
    ).length;
    const profileCompleteness =
      questionsTotal > 0 ? questionsAnswered / questionsTotal : 1.0;

    const enriched = await this.getProfileForUser(userId);
    const enrichedProfileId = enriched?.id ?? null;

    let tailoringMode: TailoringMode = 'standard';
    if (questionsTotal === 0) {
      tailoringMode = 'standard';
    } else if (profileCompleteness >= 1.0) {
      tailoringMode = 'precision';
    } else if (questionsAnswered > 0) {
      tailoringMode = 'enhanced';
    }

    return {
      hasResume: true,
      processingStatus,
      questionsTotal,
      questionsAnswered,
      profileCompleteness,
      enrichedProfileId,
      tailoringMode,
    };
  }

  private mapQueueStatusToProcessingStatus(
    status?: QueueMessageStatus,
  ): ProcessingStatus {
    switch (status) {
      case QueueMessageStatus.QUEUED:
        return 'queued';
      case QueueMessageStatus.PROCESSING:
        return 'processing';
      case QueueMessageStatus.COMPLETED:
        return 'completed';
      case QueueMessageStatus.FAILED:
        return 'failed';
      default:
        return 'none';
    }
  }

  /**
   * Recalculate and persist profile completeness from current profile question counts.
   */
  async recalculateCompleteness(userId: string): Promise<void> {
    if (!userId) return;
    const profileQuestions = await this.questionRepository.find({
      where: { userId, source: 'profile' as TailoringQuestionSource },
    });
    if (profileQuestions.length === 0) return;

    const extractedResumeContentId =
      profileQuestions[0].extractedResumeContentId;
    if (!extractedResumeContentId) return;

    const answered = profileQuestions.filter((q) => q.isAnswered).length;
    const total = profileQuestions.length;
    const profileCompleteness = total > 0 ? answered / total : 1.0;

    const existing = await this.enrichedProfileRepository.findOne({
      where: { userId, extractedResumeContentId },
    });
    if (existing) {
      existing.profileCompleteness = profileCompleteness;
      existing.questionsTotal = total;
      existing.questionsAnswered = answered;
      await this.enrichedProfileRepository.save(existing);
    }
  }
}
