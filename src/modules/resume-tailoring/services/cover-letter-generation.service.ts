import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClaudeService } from '../../../shared/modules/external/services/claude.service';
import { PromptService } from '../../../shared/services/prompt.service';
import { CacheService } from '../../../shared/services/cache.service';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { CoverLetterResult } from '../interfaces/cover-letter.interface';
import { JobAnalysisService } from './job-analysis.service';
import { ResumeContentProcessorService } from './resume-content-processor.service';
import { UserContext } from '../interfaces/user-context.interface';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';

@Injectable()
export class CoverLetterGenerationService {
  private readonly logger = new Logger(CoverLetterGenerationService.name);

  constructor(
    private readonly claudeService: ClaudeService,
    private readonly promptService: PromptService,
    private readonly cacheService: CacheService,
    private readonly jobAnalysisService: JobAnalysisService,
    private readonly resumeContentProcessorService: ResumeContentProcessorService,
    @InjectRepository(ResumeGeneration)
    private readonly resumeGenerationRepository: Repository<ResumeGeneration>,
  ) {}

  /**
   * Generate a cover letter from a previous resume generation record.
   * Reuses stored job_analysis and candidate_content to avoid re-processing.
   */
  async generateFromResumeGeneration(
    resumeGenerationId: string,
    userId: string,
  ): Promise<CoverLetterResult> {
    const record = await this.resumeGenerationRepository.findOne({
      where: { id: resumeGenerationId, user_id: userId },
      select: [
        'id',
        'job_analysis',
        'candidate_content',
        'company_name',
        'job_position',
      ],
    });

    if (!record) {
      throw new NotFoundException(
        'Resume generation record not found',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    if (!record.job_analysis || !record.candidate_content) {
      throw new BadRequestException(
        'Cover letter generation is only available for resumes generated after this feature was released. Please generate a new tailored resume first.',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return this.generateCoverLetter({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      jobAnalysis: record.job_analysis,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      candidateContent: record.candidate_content,
      companyName: record.company_name ?? '',
      jobPosition: record.job_position ?? '',
    });
  }

  /**
   * Generate a cover letter standalone (without a prior resume generation).
   */
  async generateStandalone(
    jobPosition: string,
    companyName: string,
    jobDescription: string,
    userContext: UserContext,
  ): Promise<CoverLetterResult> {
    const [jobAnalysis, resumeContent] = await Promise.all([
      this.jobAnalysisService.analyzeJobDescription(
        jobDescription,
        jobPosition,
        companyName,
      ),
      this.resumeContentProcessorService.processResumeContent(
        userContext,
        undefined,
        undefined,
      ),
    ]);

    return this.generateCoverLetter({
      jobAnalysis: jobAnalysis as unknown as Record<string, unknown>,
      candidateContent: resumeContent.content as unknown as Record<string, unknown>,
      companyName,
      jobPosition,
      verifiedFacts: resumeContent.verifiedFacts as Array<{
        originalBulletPoint: string;
        userResponse: string;
      }>,
    });
  }

  private async generateCoverLetter(input: {
    jobAnalysis: Record<string, unknown>;
    candidateContent: Record<string, unknown>;
    companyName: string;
    jobPosition: string;
    verifiedFacts?: Array<{ originalBulletPoint: string; userResponse: string }>;
  }): Promise<CoverLetterResult> {
    const cacheKey = this.cacheService.generateKey({
      jobPosition: input.jobPosition,
      company: input.companyName,
      candidateName: (
        input.candidateContent?.contactInfo as Record<string, unknown>
      )?.name,
      primaryKeywords: (
        input.jobAnalysis?.keywords as Record<string, unknown>
      )?.primary,
    });

    const cached = this.cacheService.get<CoverLetterResult>(
      cacheKey,
      'cover-letter',
    );
    if (cached) {
      this.logger.debug('Cache hit for cover letter generation');
      return cached;
    }

    const prompt = this.promptService.getCoverLetterGenerationPrompt(
      input.jobAnalysis,
      input.candidateContent,
      input.companyName,
      input.jobPosition,
      input.verifiedFacts,
    );

    const response = await this.claudeService.chatCompletion({
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1500,
      temperature: 0.3,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new InternalServerErrorException(
        'Empty response from AI for cover letter',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    const result = this.parseCoverLetterResponse(content);

    this.cacheService.set(cacheKey, result, {
      ttl: 6 * 60 * 60 * 1000,
      namespace: 'cover-letter',
    });

    return result;
  }

  private parseCoverLetterResponse(content: string): CoverLetterResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in cover letter response');
      }
      const parsed = JSON.parse(jsonMatch[0]) as CoverLetterResult;

      if (!parsed.coverLetter?.opening || !parsed.coverLetter?.body) {
        throw new Error('Invalid cover letter structure');
      }

      if (!Array.isArray(parsed.coverLetter.body)) {
        parsed.coverLetter.body = [String(parsed.coverLetter.body)];
      }

      if (!parsed.metadata) {
        parsed.metadata = {
          keyThemesAddressed: [],
          toneProfile: 'professional-confident',
          wordCount: 0,
        };
      }

      return parsed;
    } catch (error) {
      this.logger.error('Failed to parse cover letter response', {
        content: content.substring(0, 500),
        error,
      });
      throw new InternalServerErrorException(
        'Failed to parse cover letter response',
        ERROR_CODES.AI_RESPONSE_PARSING_FAILED,
      );
    }
  }
}
