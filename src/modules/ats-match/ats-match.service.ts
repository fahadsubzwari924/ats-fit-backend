import { Injectable, Logger } from '@nestjs/common';
import { AtsScoreResponseDto } from './dto/ats-score-response.dto';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../shared/exceptions/custom-http-exceptions';
import { ResumeService } from '../resume/services/resume.service';
import { PremiumAtsEvaluation } from './interfaces';
import { PromptService } from '../resume/services';
import { AtsEvaluationService } from '../../shared/services/ats-evaluation.service';
import { AIService } from '../resume/services/ai.service';

@Injectable()
export class AtsMatchService {
  private readonly logger = new Logger(AtsMatchService.name);

  constructor(
    private readonly resumeService: ResumeService,
    private readonly promptService: PromptService,
    private readonly atsEvaluationService: AtsEvaluationService,
    private readonly aiService: AIService,
  ) {}

  async calculateAtsScore(
    jobDescription: string,
    resumeFile: Express.Multer.File,
    userContext?: { userId?: string; guestId?: string },
    additionalData?: {
      companyName?: string;
      resumeContent?: string;
    },
  ): Promise<AtsScoreResponseDto> {
    const startTime = Date.now();

    try {
      if (!jobDescription || !resumeFile) {
        throw new BadRequestException(
          'Job description and resume file are required',
        );
      }

      // Extract text from resume
      const resumeText =
        await this.resumeService.extractTextFromResume(resumeFile);

      // Use the shared ATS evaluation service
      const { evaluation, atsMatchHistoryId } =
        await this.atsEvaluationService.performAtsEvaluation(
          jobDescription,
          resumeText,
          this.promptService,
          this.aiService,
          userContext,
          additionalData,
        );

      // Format response using the same logic as before
      const response = this.formatResponse(evaluation, atsMatchHistoryId);

      this.logger.log(`ATS score calculated in ${Date.now() - startTime}ms`);

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to calculate ATS score after ${Date.now() - startTime}ms`,
        error,
      );
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Failed to calculate ATS score');
    }
  }

  private formatResponse(
    atsEvaluation: PremiumAtsEvaluation,
    atsMatchHistoryId?: string,
  ): AtsScoreResponseDto {
    return {
      score: atsEvaluation.overallScore,
      atsMatchHistoryId: atsMatchHistoryId ?? '',
      details: {
        keywordScore: atsEvaluation.technicalSkillsScore,
        contactInfoScore: atsEvaluation.resumeQualityScore,
        structureScore: atsEvaluation.resumeQualityScore,
        matched: {
          hardSkills:
            atsEvaluation.detailedBreakdown.technicalSkills.matched || [],
          softSkills: atsEvaluation.detailedBreakdown.softSkills.matched || [],
          qualifications: [],
        },
        extracted: {
          technicalSkills: atsEvaluation.detailedBreakdown.technicalSkills,
          experience: atsEvaluation.detailedBreakdown.experience,
          achievements: atsEvaluation.detailedBreakdown.achievements,
          softSkills: atsEvaluation.detailedBreakdown.softSkills,
        },
        sectionScores: {
          technicalSkills: atsEvaluation.technicalSkillsScore,
          experienceAlignment: atsEvaluation.experienceAlignmentScore,
          achievements: atsEvaluation.achievementsScore,
          softSkills: atsEvaluation.softSkillsScore,
          resumeQuality: atsEvaluation.resumeQualityScore,
        },
        skillMatchScore: atsEvaluation.technicalSkillsScore / 100,
        missingKeywords:
          atsEvaluation.detailedBreakdown.technicalSkills.missing || [],
        tailoredContent: {
          strengths: atsEvaluation.detailedBreakdown.strengths || [],
          weaknesses: atsEvaluation.detailedBreakdown.weaknesses || [],
          recommendations:
            atsEvaluation.detailedBreakdown.recommendations || [],
        },
        atsEvaluation: atsEvaluation,
      },
    };
  }
}
