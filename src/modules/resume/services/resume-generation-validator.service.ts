import { Injectable, Logger } from '@nestjs/common';
import { ResumeSelectionService } from '../../ats-match/services/resume-selection.service';
import { ResumeTemplateService } from './resume-templates.service';
import { UserType, UserPlan } from '../../../database/entities/user.entity';
import { ResumeGenerationV2Input } from '../interfaces/resume-generation-v2.interface';
import { UserContext } from '../interfaces/user-context.interface';
import { NotFoundException } from '../../../shared/exceptions/custom-http-exceptions';

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  requiresFileUpload: boolean;
  hasExistingResumes: boolean;
  templateExists: boolean;
  validationErrors: string[];
}

/**
 * Resume Generation Validator Service
 *
 * Implements comprehensive upfront validation for the V2 resume generation pipeline
 * following the "fail fast" principle and SOLID design principles.
 *
 * Single Responsibility: Only validates input parameters and prerequisites
 * Open/Closed: Extensible for new validation rules without modification
 * Liskov Substitution: Can be substituted with other validation implementations
 * Interface Segregation: Focused validation interface
 * Dependency Inversion: Depends on abstractions, not concretions
 */
@Injectable()
export class ResumeGenerationValidatorService {
  private readonly logger = new Logger(ResumeGenerationValidatorService.name);

  constructor(
    private readonly resumeSelectionService: ResumeSelectionService,
    private readonly resumeTemplateService: ResumeTemplateService,
  ) {}

  /**
   * Perform comprehensive upfront validation of all inputs and prerequisites
   *
   * This method validates all requirements BEFORE any processing begins:
   * - Input parameter validation
   * - User context validation
   * - Resume file requirements based on user type
   * - Template existence
   * - User's existing resume availability
   *
   * @param input - Complete input for resume generation
   * @returns Promise<ValidationResult> - Detailed validation results
   */
  async validateGenerationRequest(
    input: ResumeGenerationV2Input,
  ): Promise<ValidationResult> {
    const startTime = Date.now();
    const validationErrors: string[] = [];

    try {
      this.logger.log(
        `Starting comprehensive validation for ${input.userContext.userType} user`,
      );

      // Step 1: Validate basic input parameters
      this.validateBasicInputs(input, validationErrors);

      // Step 2: Validate user context
      this.validateUserContext(input.userContext, validationErrors);

      // Step 3: Validate template existence
      const templateExists = await this.validateTemplate(
        input.templateId,
        validationErrors,
      );

      // Step 4: Validate resume requirements based on user type
      const { requiresFileUpload, hasExistingResumes } =
        await this.validateResumeRequirements(input, validationErrors);

      const validationTime = Date.now() - startTime;
      const isValid = validationErrors.length === 0;

      this.logger.log(
        `Validation completed in ${validationTime}ms. ` +
          `Valid: ${isValid}, Errors: ${validationErrors.length}`,
      );

      if (!isValid) {
        this.logger.warn('Validation failed:', { errors: validationErrors });
      }

      return {
        isValid,
        requiresFileUpload,
        hasExistingResumes,
        templateExists,
        validationErrors,
      };
    } catch (error) {
      const validationTime = Date.now() - startTime;
      this.logger.error(`Validation failed after ${validationTime}ms`, error);

      // Add validation system error
      validationErrors.push('Internal validation error occurred');

      return {
        isValid: false,
        requiresFileUpload: true, // Safe default
        hasExistingResumes: false,
        templateExists: false,
        validationErrors,
      };
    }
  }

  /**
   * Validate basic input parameters
   */
  private validateBasicInputs(
    input: ResumeGenerationV2Input,
    errors: string[],
  ): void {
    // Job description validation
    if (!input.jobDescription || typeof input.jobDescription !== 'string') {
      errors.push('Job description is required and must be a string');
    } else if (input.jobDescription.trim().length < 50) {
      errors.push('Job description must be at least 50 characters long');
    } else if (input.jobDescription.length > 15000) {
      errors.push('Job description cannot exceed 15,000 characters');
    }

    // Job position validation
    if (!input.jobPosition || typeof input.jobPosition !== 'string') {
      errors.push('Job position is required and must be a string');
    } else if (input.jobPosition.trim().length < 2) {
      errors.push('Job position must be at least 2 characters long');
    } else if (input.jobPosition.length > 200) {
      errors.push('Job position cannot exceed 200 characters');
    }

    // Company name validation
    if (!input.companyName || typeof input.companyName !== 'string') {
      errors.push('Company name is required and must be a string');
    } else if (input.companyName.trim().length < 2) {
      errors.push('Company name must be at least 2 characters long');
    } else if (input.companyName.length > 200) {
      errors.push('Company name cannot exceed 200 characters');
    }

    // Template ID validation
    if (!input.templateId || typeof input.templateId !== 'string') {
      errors.push('Template ID is required and must be a string');
    } else if (input.templateId.trim().length === 0) {
      errors.push('Template ID cannot be empty');
    }
  }

  /**
   * Validate user context
   */
  private validateUserContext(
    userContext: UserContext,
    errors: string[],
  ): void {
    if (!userContext || typeof userContext !== 'object') {
      errors.push('User context is required and must be an object');
      return;
    }

    // Validate user type
    const validUserTypes = ['guest', 'freemium', 'premium'];
    if (!validUserTypes.includes(userContext.userType)) {
      errors.push(
        `Invalid user type: ${userContext.userType}. Must be one of: ${validUserTypes.join(', ')}`,
      );
    }

    // For registered users, userId is required
    if (
      userContext.userType !== 'guest' &&
      (!userContext.userId || typeof userContext.userId !== 'string')
    ) {
      errors.push('User ID is required for registered users');
    }

    // For guest users, either userId or guestId should be present
    if (
      userContext.userType === 'guest' &&
      !userContext.userId &&
      !userContext.guestId
    ) {
      errors.push('Either user ID or guest ID is required for guest users');
    }

    // Validate ID formats (basic UUID validation)
    if (userContext.userId && !this.isValidUUID(userContext.userId)) {
      errors.push('User ID must be a valid UUID format');
    }

    if (userContext.guestId && !this.isValidUUID(userContext.guestId)) {
      errors.push('Guest ID must be a valid UUID format');
    }
  }

  /**
   * Validate template existence
   */
  private async validateTemplate(
    templateId: string,
    errors: string[],
  ): Promise<boolean> {
    try {
      const template =
        await this.resumeTemplateService.getTemplateById(templateId);

      if (!template) {
        errors.push(`Template with ID '${templateId}' not found`);
        return false;
      }

      // Additional template validation could go here
      // (e.g., template active status, user permissions, etc.)

      return true;
    } catch (error) {
      this.logger.error(`Failed to validate template ${templateId}`, error);
      errors.push(`Unable to verify template availability: ${templateId}`);
      return false;
    }
  }

  /**
   * Validate resume requirements based on user type and availability
   */
  private async validateResumeRequirements(
    input: ResumeGenerationV2Input,
    errors: string[],
  ): Promise<{ requiresFileUpload: boolean; hasExistingResumes: boolean }> {
    const userContext = input.userContext;

    // Guest users always require file upload
    if (userContext.userType === 'guest') {
      if (!input.resumeFile) {
        errors.push('Resume file is required for guest users');
      } else {
        this.validateResumeFile(input.resumeFile, errors);
      }

      return {
        requiresFileUpload: true,
        hasExistingResumes: false,
      };
    }

    // For registered users, check existing resumes
    const hasExistingResumes = await this.checkUserHasExistingResumes(
      userContext.userId,
    );

    // If user has no existing resumes, file upload is required
    if (!hasExistingResumes && !input.resumeFile) {
      errors.push(
        'Resume file is required - no processed resumes found in your account',
      );
    }

    // If resume file is provided, validate it
    if (input.resumeFile) {
      this.validateResumeFile(input.resumeFile, errors);
    }

    // If specific resume ID is provided, validate it exists
    if (input.resumeId && hasExistingResumes) {
      await this.validateSpecificResume(
        userContext.userId,
        input.resumeId,
        errors,
      );
    }

    return {
      requiresFileUpload: !hasExistingResumes && !input.resumeFile,
      hasExistingResumes,
    };
  }

  /**
   * Validate uploaded resume file
   */
  private validateResumeFile(
    resumeFile: Express.Multer.File,
    errors: string[],
  ): void {
    if (!resumeFile) {
      errors.push('Resume file is required');
      return;
    }

    // Check file type
    if (resumeFile.mimetype !== 'application/pdf') {
      errors.push('Only PDF files are supported');
    }

    // Check file size (10MB limit)
    const maxSizeBytes = 10 * 1024 * 1024; // 10MB
    if (resumeFile.size > maxSizeBytes) {
      errors.push('File size cannot exceed 10MB');
    }

    // Check minimum file size (1KB)
    if (resumeFile.size < 1024) {
      errors.push('File size is too small - minimum 1KB required');
    }

    // Check if file has content
    if (!resumeFile.buffer || resumeFile.buffer.length === 0) {
      errors.push('Resume file appears to be empty');
    }

    // Validate filename
    if (!resumeFile.originalname || resumeFile.originalname.trim() === '') {
      errors.push('Resume file must have a valid filename');
    }
  }

  /**
   * Check if user has existing processed resumes
   */
  private async checkUserHasExistingResumes(userId: string): Promise<boolean> {
    try {
      const availableResumes =
        await this.resumeSelectionService.getUserAvailableResumes(userId);
      return availableResumes.length > 0;
    } catch (error) {
      this.logger.warn(
        `Error checking existing resumes for user ${userId}`,
        error,
      );
      // Don't add error to validation errors as this is not necessarily a user error
      // Return false as safe default
      return false;
    }
  }

  /**
   * Validate specific resume ID exists for user
   */
  private async validateSpecificResume(
    userId: string,
    resumeId: string,
    errors: string[],
  ): Promise<void> {
    try {
      const convertedUserContext = this.convertToResumeSelectionUserContext({
        userId,
        userType: 'freemium', // We'll determine actual type later
      } as UserContext);

      await this.resumeSelectionService.selectResume(convertedUserContext, {
        resumeId,
        useLatestResume: false,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        errors.push(`Resume with ID '${resumeId}' not found for this user`);
      } else {
        this.logger.error(
          `Error validating resume ${resumeId} for user ${userId}`,
          error,
        );
        errors.push(`Unable to verify resume availability: ${resumeId}`);
      }
    }
  }

  /**
   * Convert UserContext to ResumeSelectionService format
   */
  private convertToResumeSelectionUserContext(userContext: UserContext): {
    userId?: string;
    guestId?: string;
    userType: UserType;
    plan?: UserPlan;
  } {
    if (userContext.userType === 'guest') {
      return {
        userId: userContext.userId,
        guestId: userContext.guestId,
        userType: UserType.GUEST,
      };
    }

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

  /**
   * Basic UUID validation
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}
