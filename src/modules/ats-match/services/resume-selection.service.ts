import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { UserType, UserPlan } from '../../../database/entities/user.entity';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { ResumeContentService } from '../../resume-tailoring/services/resume-content.service';

export interface ResumeSelectionOptions {
  resumeId?: string;
  useLatestResume?: boolean;
}

export interface UserContext {
  userId?: string;
  guestId?: string;
  userType: UserType;
  plan?: UserPlan;
}

export interface ResumeSelectionResult {
  extractedText: string;
  structuredContent?: any;
  resumeId: string;
  usageUpdated: boolean;
}

/**
 * Service responsible for selecting and retrieving pre-processed resume content
 * Follows Single Responsibility Principle - only handles resume selection logic
 * Implements Open/Closed Principle - extensible for different selection strategies
 */
@Injectable()
export class ResumeSelectionService {
  private readonly logger = new Logger(ResumeSelectionService.name);

  constructor(
    @InjectRepository(ExtractedResumeContent)
    private readonly extractedResumeRepository: Repository<ExtractedResumeContent>,
    private readonly resumeContentService: ResumeContentService,
  ) {}

  /**
   * Determines if a user can use pre-processed resume content
   * Guest users cannot use this feature
   */
  canUsePreProcessedResume(userContext: UserContext): boolean {
    return userContext.userType !== UserType.GUEST && !!userContext.userId;
  }

  /**
   * Validates that user has permission to use resume selection feature
   */
  private validateUserPermissions(userContext: UserContext): void {
    if (!this.canUsePreProcessedResume(userContext)) {
      throw new UnauthorizedException(
        'Pre-processed resume selection is not available for guest users. Please upload a resume file.',
        ERROR_CODES.FEATURE_NOT_AVAILABLE_FOR_GUEST_USERS,
      );
    }
  }

  /**
   * Validates resume selection options
   */
  private validateSelectionOptions(
    options: ResumeSelectionOptions,
  ): ResumeSelectionOptions {
    const { resumeId, useLatestResume } = options;

    // Cannot specify both resumeId and useLatestResume
    if (resumeId && useLatestResume) {
      throw new BadRequestException(
        'Cannot specify both resumeId and useLatestResume. Please choose one option.',
        ERROR_CODES.INVALID_RESUME_SELECTION_OPTIONS,
      );
    }

    // Must specify at least one option
    if (!resumeId && !useLatestResume) {
      throw new BadRequestException(
        'Must specify either resumeId or useLatestResume to use pre-processed resume.',
        ERROR_CODES.RESUME_SELECTION_REQUIRED,
      );
    }

    return options;
  }

  /**
   * Get resume by specific ID
   */
  private async getResumeById(
    resumeId: string,
    userId: string,
  ): Promise<ExtractedResumeContent> {
    const resume = await this.resumeContentService.getUserExtractedResumeById(
      resumeId,
      userId,
    );

    if (!resume) {
      throw new NotFoundException(
        `Resume with ID ${resumeId} not found or does not belong to user`,
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    // Validate that resume processing is completed
    if (!resume.extractedText || !resume.structuredContent) {
      throw new BadRequestException(
        'Resume processing is not yet complete. Please wait for processing to finish or upload a resume file.',
        ERROR_CODES.RESUME_PROCESSING_INCOMPLETE,
      );
    }

    return resume;
  }

  /**
   * Get the most recent resume for a user
   */
  private async getLatestResume(
    userId: string,
  ): Promise<ExtractedResumeContent> {
    const resumes = await this.extractedResumeRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 1,
    });

    if (!resumes.length) {
      throw new NotFoundException(
        'No processed resumes found. Please upload and process a resume first.',
        ERROR_CODES.NO_PROCESSED_RESUMES_FOUND,
      );
    }

    const resume = resumes[0];

    // Validate that resume processing is completed
    if (!resume.extractedText || !resume.structuredContent) {
      throw new BadRequestException(
        'Latest resume processing is not yet complete. Please wait for processing to finish or upload a resume file.',
        ERROR_CODES.RESUME_PROCESSING_INCOMPLETE,
      );
    }

    // Update usage statistics
    resume.incrementUsageCount();
    await this.extractedResumeRepository.save(resume);

    return resume;
  }

  /**
   * Select and retrieve resume content based on provided options
   * Main method that orchestrates the resume selection logic
   */
  async selectResume(
    userContext: UserContext,
    options: ResumeSelectionOptions,
  ): Promise<ResumeSelectionResult> {
    this.logger.log(
      `Selecting resume for user ${userContext.userId} with options: ${JSON.stringify(options)}`,
    );

    // Validate permissions
    this.validateUserPermissions(userContext);

    // Validate options
    const validatedOptions = this.validateSelectionOptions(options);
    const { resumeId, useLatestResume } = validatedOptions;

    let resume: ExtractedResumeContent;
    let usageUpdated = false;

    try {
      if (resumeId) {
        resume = await this.getResumeById(resumeId, userContext.userId);
        usageUpdated = true; // getResumeById calls queueService which updates usage
      } else if (useLatestResume) {
        resume = await this.getLatestResume(userContext.userId);
        usageUpdated = true; // getLatestResume updates usage internally
      } else {
        throw new BadRequestException(
          'Invalid resume selection options',
          ERROR_CODES.INVALID_RESUME_SELECTION_OPTIONS,
        );
      }

      this.logger.log(
        `Successfully selected resume ${resume.id} for user ${userContext.userId}`,
      );

      return {
        extractedText: resume.extractedText,
        structuredContent: resume.structuredContent,
        resumeId: resume.id,
        usageUpdated,
      };
    } catch (error) {
      this.logger.error(
        `Failed to select resume for user ${userContext.userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get available resumes for a user (for UI listing)
   */
  async getUserAvailableResumes(userId: string): Promise<
    Array<{
      id: string;
      originalFileName: string;
      createdAt: Date;
      usageCount: number;
      isRecentlyUsed: boolean;
      isProcessingComplete: boolean;
    }>
  > {
    const resumes = await this.extractedResumeRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return resumes.map((resume) => ({
      id: resume.id,
      originalFileName: resume.originalFileName,
      createdAt: resume.createdAt,
      usageCount: resume.usageCount,
      isRecentlyUsed: resume.isRecentlyUsed,
      isProcessingComplete: !!(
        resume.extractedText && resume.structuredContent
      ),
    }));
  }
}
