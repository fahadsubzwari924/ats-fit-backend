import { Injectable, Logger } from '@nestjs/common';
import { ResumeSelectionService } from '../../ats-match/services/resume-selection.service';
import { AIContentService } from '../../../shared/services/ai-content.service';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import {
  UserContext,
  ResumeContentResult,
} from '../interfaces/user-context.interface';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { ResumeService } from './resume.service';
import { UserType, UserPlan } from '../../../database/entities/user.entity';
import * as pdf from 'pdf-parse';

/**
 * Resume Content Processor Service V2
 *
 * Handles smart resume content processing that adapts to user type:
 * - Guest users: Always extract from uploaded file
 * - Registered users: Use database content if available, otherwise extract from file
 *
 * This service orchestrates between file processing and database retrieval
 * while maintaining consistent output format for downstream processing.
 *
 * Key improvements over V1:
 * - Smart user-type-aware processing
 * - Reuses existing ResumeSelectionService logic
 * - Enhanced error handling and validation
 * - Comprehensive metadata tracking
 */
@Injectable()
export class ResumeContentProcessorService {
  private readonly logger = new Logger(ResumeContentProcessorService.name);

  constructor(
    private readonly resumeSelectionService: ResumeSelectionService,
    private readonly aiContentService: AIContentService,
    private readonly resumeService: ResumeService,
  ) {}

  /**
   * Process resume content based on user type and available data
   *
   * @param userContext - User context (guest/registered)
   * @param resumeFile - Optional resume file upload
   * @param resumeId - Optional specific resume ID for registered users
   * @returns Promise<ResumeContentResult> - Processed resume content with metadata
   */
  async processResumeContent(
    userContext: UserContext,
    resumeFile?: Express.Multer.File,
    resumeId?: string,
  ): Promise<ResumeContentResult> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Processing resume content for ${userContext.userType} user${userContext.userId ? ` (ID: ${userContext.userId})` : ''}`,
      );

      // For guest users, always require file upload
      if (userContext.userType === 'guest') {
        return await this.processGuestResumeContent(userContext, resumeFile);
      }

      // For registered users, use smart selection logic
      return await this.processRegisteredUserResumeContent(
        userContext,
        resumeFile,
        resumeId,
      );
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Resume content processing failed after ${processingTime}ms`,
        error,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to process resume content',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Process resume content for guest users (always from file upload)
   */
  private async processGuestResumeContent(
    userContext: UserContext,
    resumeFile?: Express.Multer.File,
  ): Promise<ResumeContentResult> {
    const startTime = Date.now();

    if (!resumeFile) {
      throw new BadRequestException(
        'Resume file is required for guest users',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    this.validateResumeFile(resumeFile);

    try {
      // Extract text from PDF
      const resumeText = await this.extractTextFromFile(resumeFile);

      // Use AI to extract structured content
      const structuredContent =
        await this.aiContentService.extractResumeContent(resumeText);

      const processingTime = Date.now() - startTime;

      this.logger.log(
        `Guest resume processed in ${processingTime}ms from file upload`,
      );

      return {
        content: structuredContent,
        source: 'file_upload',
        originalText: resumeText,
        metadata: {
          extractionMethod: 'ai_extraction_from_file',
          processingTime: processingTime,
          fileSize: resumeFile.size,
        },
      };
    } catch {
      throw new InternalServerErrorException(
        'Failed to extract content from resume file',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Process resume content for registered users (smart selection)
   */
  private async processRegisteredUserResumeContent(
    userContext: UserContext,
    resumeFile?: Express.Multer.File,
    resumeId?: string,
  ): Promise<ResumeContentResult> {
    if (!userContext.userId) {
      throw new BadRequestException(
        'User ID is required for registered users',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    try {
      // Check if user has processed resumes in database
      const hasProcessedResumes = await this.checkUserHasProcessedResumes(
        userContext.userId,
      );

      // If no processed resumes and no file upload, require file
      if (!hasProcessedResumes && !resumeFile) {
        throw new BadRequestException(
          'Resume file is required - no processed resumes found in your account',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      // If file is provided, prefer file extraction (user wants to use new resume)
      if (resumeFile) {
        this.validateResumeFile(resumeFile);
        return await this.processFromFileUpload(userContext, resumeFile);
      }

      // Use database content with resume selection logic
      return await this.processFromDatabase(userContext, resumeId);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to process registered user resume content',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Process resume from file upload (for registered users choosing new resume)
   */
  private async processFromFileUpload(
    userContext: UserContext,
    resumeFile: Express.Multer.File,
  ): Promise<ResumeContentResult> {
    const startTime = Date.now();

    try {
      const resumeText = await this.extractTextFromFile(resumeFile);
      const structuredContent =
        await this.aiContentService.extractResumeContent(resumeText);

      const processingTime = Date.now() - startTime;

      this.logger.log(
        `Registered user resume processed in ${processingTime}ms from new file upload`,
      );

      return {
        content: structuredContent,
        source: 'file_upload',
        originalText: resumeText,
        metadata: {
          extractionMethod: 'ai_extraction_from_file',
          processingTime: processingTime,
          fileSize: resumeFile.size,
        },
      };
    } catch (error) {
      this.logger.error(
        'Failed to extract content from uploaded resume file',
        error,
      );
      throw new InternalServerErrorException(
        'Failed to extract content from uploaded resume file',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Process resume from database (for registered users using existing resumes)
   */
  private async processFromDatabase(
    userContext: UserContext,
    resumeId?: string,
  ): Promise<ResumeContentResult> {
    const startTime = Date.now();

    try {
      // Use existing resume selection logic
      const selectionResult = await this.resumeSelectionService.selectResume(
        this.convertToResumeSelectionUserContext(userContext),
        {
          resumeId,
          useLatestResume: !resumeId, // Use latest if no specific ID provided
        },
      );

      // Check if we have structured content in database
      if (selectionResult.structuredContent) {
        const processingTime = Date.now() - startTime;

        this.logger.log(
          `Resume content retrieved from database in ${processingTime}ms (resume ID: ${selectionResult.resumeId})`,
        );

        return {
          content: selectionResult.structuredContent as TailoredContent,
          source: 'database_existing',
          originalText: selectionResult.extractedText,
          metadata: {
            extractionMethod: 'database_existing_structured',
            processingTime: processingTime,
            resumeId: selectionResult.resumeId,
          },
        };
      }

      // If no structured content, extract from raw text using AI
      const structuredContent =
        await this.aiContentService.extractResumeContent(
          selectionResult.extractedText,
        );

      const processingTime = Date.now() - startTime;

      this.logger.log(
        `Resume content extracted from database text in ${processingTime}ms (resume ID: ${selectionResult.resumeId})`,
      );

      return {
        content: structuredContent,
        source: 'database_extraction',
        originalText: selectionResult.extractedText,
        metadata: {
          extractionMethod: 'ai_extraction_from_database',
          processingTime: processingTime,
          resumeId: selectionResult.resumeId,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to process resume from database',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Check if user has any processed resumes in database
   */
  private async checkUserHasProcessedResumes(userId: string): Promise<boolean> {
    try {
      const availableResumes =
        await this.resumeSelectionService.getUserAvailableResumes(userId);
      return availableResumes.length > 0;
    } catch (error) {
      // If error checking resumes, assume no resumes available
      this.logger.warn(
        `Error checking user processed resumes for user ${userId}`,
        error,
      );
      return false;
    }
  }

  /**
   * Extract text content from uploaded file
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
   * Validate uploaded resume file
   */
  private validateResumeFile(resumeFile: Express.Multer.File): void {
    if (!resumeFile) {
      throw new BadRequestException(
        'Resume file is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Check file type
    if (resumeFile.mimetype !== 'application/pdf') {
      throw new BadRequestException(
        'Only PDF files are supported',
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    // Check file size (10MB limit)
    const maxSizeBytes = 10 * 1024 * 1024; // 10MB
    if (resumeFile.size > maxSizeBytes) {
      throw new BadRequestException(
        'File size cannot exceed 10MB',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Check minimum file size (1KB)
    if (resumeFile.size < 1024) {
      throw new BadRequestException(
        'File size is too small - minimum 1KB required',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Convert UserContext to ResumeSelectionService UserContext format
   */
  private convertToResumeSelectionUserContext(userContext: UserContext): {
    userId?: string;
    guestId?: string;
    userType: UserType;
    plan?: UserPlan;
  } {
    // Map our userType to the database UserType and UserPlan
    if (userContext.userType === 'guest') {
      return {
        userId: userContext.userId,
        guestId: userContext.guestId,
        userType: UserType.GUEST,
      };
    }

    // For freemium and premium users, they are registered users with different plans
    return {
      userId: userContext.userId,
      guestId: userContext.guestId,
      userType: UserType.REGISTERED,
      plan:
        userContext.userType === 'freemium'
          ? UserPlan.FREEMIUM
          : UserPlan.PREMIUM,
    };
  }
}
