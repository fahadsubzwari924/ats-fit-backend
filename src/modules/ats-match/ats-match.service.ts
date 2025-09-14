import { Injectable, Logger } from '@nestjs/common';
import { AtsScoreResponseDto } from './dto/ats-score-response.dto';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { ResumeService } from '../resume/services/resume.service';
import { ExtractedResumeService } from '../resume/services/extracted-resume.service';
import { PremiumAtsEvaluation } from './interfaces';
import { PromptService } from '../resume/services';
import { AtsEvaluationService } from '../../shared/services/ats-evaluation.service';
import { AIService } from '../resume/services/ai.service';
import { ResumeInputData } from '../../shared/interfaces/resume-input.interface';
import {
  ResumeSourceStrategy,
  ResumeSourceDecision,
} from '../../shared/constants/resume-strategy.constants';

@Injectable()
export class AtsMatchService {
  private readonly logger = new Logger(AtsMatchService.name);

  constructor(
    private readonly resumeService: ResumeService,
    private readonly promptService: PromptService,
    private readonly atsEvaluationService: AtsEvaluationService,
    private readonly aiService: AIService,
    private readonly extractedResumeService: ExtractedResumeService,
  ) {}

  /**
   * Validates the request before processing
   * Centralizes all validation logic for better maintainability
   *
   * To add new validation rules:
   * 1. Add new validation method (e.g., validateRateLimit, validateFileSize)
   * 2. Call it from this central method
   * 3. Strategy determination remains unchanged
   */
  private async validateRequest(
    userContext: { userId?: string; userType: string },
    hasFileUpload: boolean,
  ): Promise<void> {
    // For registered users, check if they have processed resume and are trying to upload file
    if (userContext?.userId && userContext.userType !== 'guest') {
      const hasProcessedResume =
        await this.extractedResumeService.hasProcessedResume(
          userContext.userId,
        );

      if (hasProcessedResume && hasFileUpload) {
        throw new BadRequestException(
          'Cannot upload new resume. You already have a processed resume in the system. Please use the existing resume for ATS evaluation.',
          ERROR_CODES.SINGLE_RESUME_UPLOAD_ALLOWED,
        );
      }
    }

    // Validate file requirements for different user types
    await this.validateFileRequirements(userContext, hasFileUpload);
  }

  /**
   * Validates file upload requirements based on user type and processed resume status
   */
  private async validateFileRequirements(
    userContext: { userId?: string; userType: string },
    hasFileUpload: boolean,
  ): Promise<void> {
    // Guest users always require file upload
    if (userContext?.userType === 'guest' && !hasFileUpload) {
      throw new BadRequestException(
        'Guest users must provide resume file for processing',
        ERROR_CODES.FEATURE_NOT_AVAILABLE_FOR_GUEST_USERS,
      );
    }

    // Registered users without processed resume require file upload
    if (userContext?.userId && userContext.userType !== 'guest') {
      const hasProcessedResume =
        await this.extractedResumeService.hasProcessedResume(
          userContext.userId,
        );

      if (!hasProcessedResume && !hasFileUpload) {
        throw new BadRequestException(
          'No processed resume found - file upload required for initial setup',
          ERROR_CODES.RESUME_SELECTION_REQUIRED,
        );
      }
    }
  }

  /**
   * Determines the appropriate resume source strategy
   * Focuses purely on strategy determination without validation
   */
  private async determineResumeStrategy(userContext: {
    userId?: string;
    userType: string;
  }): Promise<ResumeSourceDecision> {
    // Guest users always require file upload
    if (userContext?.userType === 'guest') {
      return {
        strategy: ResumeSourceStrategy.GUEST_FILE_REQUIRED,
        reason: 'Guest users must provide resume file for processing',
        requiresFile: true,
        usesDatabase: false,
      };
    }

    // Registered users - check for existing processed resume
    if (userContext?.userId) {
      const hasProcessedResume =
        await this.extractedResumeService.hasProcessedResume(
          userContext.userId,
        );

      if (hasProcessedResume) {
        // Use existing processed resume (validation already handled)
        return {
          strategy: ResumeSourceStrategy.REGISTERED_USE_EXISTING,
          reason: 'Using existing processed resume for optimal performance',
          requiresFile: false,
          usesDatabase: true,
        };
      } else {
        return {
          strategy: ResumeSourceStrategy.REGISTERED_FILE_REQUIRED,
          reason:
            'No processed resume found - file upload required for initial setup',
          requiresFile: true,
          usesDatabase: false,
        };
      }
    }

    // Should not reach here with proper validation
    throw new BadRequestException(
      'Invalid user context provided for resume strategy determination',
      ERROR_CODES.BAD_REQUEST,
    );
  }

  /**
   * Smart resume input detection method - User Context Driven
   * Prioritizes user's existing data over file uploads for better UX
   */
  private async getResumeInput(
    userContext: { userId?: string; userType: string },
    resumeFile?: Express.Multer.File,
  ): Promise<ResumeInputData> {
    // Centralized validation - must be done before strategy determination
    await this.validateRequest(userContext, !!resumeFile);

    // Determine strategy based on user context (validation already completed)
    const strategy = await this.determineResumeStrategy(userContext);

    this.logger.log(
      `Resume strategy determined: ${strategy.strategy} - ${strategy.reason}`,
      {
        userId: userContext.userId,
        userType: userContext.userType,
        hasFile: !!resumeFile,
        strategy: strategy.strategy,
      },
    );

    // Execute strategy (validation already completed)
    switch (strategy.strategy) {
      case ResumeSourceStrategy.GUEST_FILE_REQUIRED:
      case ResumeSourceStrategy.REGISTERED_FILE_REQUIRED: {
        // Use file upload
        const resumeText =
          await this.resumeService.extractTextFromResume(resumeFile);
        return {
          text: resumeText,
          source: 'file',
          originalFileName: resumeFile.originalname,
        };
      }

      case ResumeSourceStrategy.REGISTERED_USE_EXISTING: {
        // Use existing processed resume
        const userResume =
          await this.extractedResumeService.getUserProcessedResume(
            userContext.userId,
          );

        if (!userResume) {
          // Edge case: processed resume was deleted between strategy determination and execution
          throw new BadRequestException(
            'Processed resume no longer available. Please upload a resume file.',
            ERROR_CODES.RESUME_PROCESSING_INCOMPLETE,
          );
        }

        return {
          text: userResume.extractedText,
          source: 'database',
          resumeId: userResume.id,
        };
      }

      default:
        throw new BadRequestException(
          'Unsupported resume strategy encountered during processing',
          ERROR_CODES.BAD_REQUEST,
        );
    }
  }

  /**
   * Enhanced ATS score calculation with smart resume detection
   * Supports both file upload and pre-processed resumes
   */
  async calculateAtsScore(
    jobDescription: string,
    resumeFile?: Express.Multer.File,
    userContext?: { userId?: string; guestId?: string; userType?: string },
    additionalData?: {
      companyName?: string;
      resumeContent?: string;
    },
  ): Promise<AtsScoreResponseDto> {
    const startTime = Date.now();

    try {
      if (!jobDescription) {
        throw new BadRequestException(
          'Job description is required',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      // Prepare user context with userType
      const contextWithType = {
        userId: userContext?.userId,
        userType: userContext?.userType || 'guest',
      };

      // Smart resume input detection
      const resumeInput = await this.getResumeInput(
        contextWithType,
        resumeFile,
      );

      // Use the shared ATS evaluation service
      const { evaluation, atsMatchHistoryId } =
        await this.atsEvaluationService.performAtsEvaluation(
          jobDescription,
          resumeInput.text,
          this.promptService,
          this.aiService,
          userContext,
          additionalData,
        );

      // Format response using the same logic as before
      const response = this.formatResponse(evaluation, atsMatchHistoryId);

      this.logger.log(
        `ATS score calculated using ${resumeInput.source} resume in ${Date.now() - startTime}ms`,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `Failed to calculate ATS score after ${Date.now() - startTime}ms`,
        error,
      );
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException(
        'Failed to calculate ATS score',
        ERROR_CODES.INTERNAL_SERVER,
      );
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
