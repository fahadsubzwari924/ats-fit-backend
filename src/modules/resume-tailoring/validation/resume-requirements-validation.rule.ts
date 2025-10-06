import { Injectable, Logger } from '@nestjs/common';
import {
  BaseValidationRule,
  ValidationRuleResult,
} from '../../../shared/modules/validation';
import { ResumeValidationContext } from '../interfaces/resume-validation-context.interface';
import { ResumeSelectionService } from '../../ats-match/services/resume-selection.service';
import { UserType, UserPlan } from '../../../database/entities/user.entity';
import { UserContext } from '../interfaces/user-context.interface';
import { NotFoundException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

/**
 * Resume Requirements Validation Rule
 *
 * Validates resume requirements based on user type and availability.
 * This rule ensures that resume sources are available for the generation process.
 */
@Injectable()
export class ResumeRequirementsValidationRule extends BaseValidationRule<ResumeValidationContext> {
  protected readonly logger = new Logger(ResumeRequirementsValidationRule.name);

  constructor(private readonly resumeSelectionService: ResumeSelectionService) {
    super();
  }

  getRuleName(): string {
    return 'ResumeRequirementsValidation';
  }

  getPriority(): number {
    return 40; // Lower priority - runs after basic validations
  }

  protected async executeValidation(
    context: ResumeValidationContext,
  ): Promise<ValidationRuleResult> {
    this.logger.debug(
      `Validating resume requirements for ${context.userContext?.userType} user`,
    );

    const errors: string[] = [];
    const warnings: string[] = [];

    const userContext = context.userContext;
    const resumeFile = context.input?.resumeFile;
    const resumeId = context.input?.resumeId;

    if (!userContext) {
      errors.push(
        'User context is required for resume requirements validation',
      );
      return this.createFailureResult(errors);
    }

    // Guest users always require file upload
    if (userContext.userType === 'guest') {
      if (!resumeFile) {
        errors.push('Resume file is required for guest users');
      }
      return errors.length > 0
        ? this.createFailureResult(errors, warnings)
        : this.createSuccessResult(warnings);
    }

    // For registered users, check existing resumes
    const hasExistingResumes = await this.checkUserHasExistingResumes(
      userContext.userId,
    );

    // If user has no existing resumes, file upload is required
    if (!hasExistingResumes && !resumeFile) {
      errors.push(
        'Resume file is required - no processed resumes found in your account',
      );
    }

    // BUSINESS RULE: Premium users cannot upload files if they have existing processed resumes
    if (
      userContext.userType === 'premium' &&
      hasExistingResumes &&
      resumeFile
    ) {
      this.logger.warn(
        `Premium user ${userContext.userId} attempted to upload file while having existing processed resumes`,
      );
      return this.createStructuredFailureResult({
        message:
          'Premium users cannot upload new resume files when processed resumes already exist in their account. Please use an existing resume or contact support.',
        code: ERROR_CODES.PREMIUM_USER_FILE_UPLOAD_RESTRICTED,
      });
    }

    // If specific resume ID is provided, validate it exists
    if (resumeId && hasExistingResumes) {
      const resumeValidationResult = await this.validateSpecificResume(
        userContext.userId,
        resumeId,
      );
      if (!resumeValidationResult.isValid) {
        errors.push(...resumeValidationResult.errors);
      }
      warnings.push(...resumeValidationResult.warnings);
    }

    // Add informational warnings (only if not already an error case)
    if (!hasExistingResumes) {
      warnings.push(
        'No existing resumes found in account - using uploaded file',
      );
    } else if (resumeFile && userContext.userType !== 'premium') {
      // Only warn for non-premium users (premium users get error above)
      warnings.push('Both existing resumes and uploaded file available');
    }

    this.logger.debug(
      `Resume requirements validation completed: ${errors.length} errors, ${warnings.length} warnings`,
    );

    return errors.length > 0
      ? this.createFailureResult(errors, warnings)
      : this.createSuccessResult(warnings);
  }

  /**
   * Check if user has existing processed resumes
   */
  private async checkUserHasExistingResumes(userId?: string): Promise<boolean> {
    if (!userId) {
      return false;
    }

    try {
      const availableResumes =
        await this.resumeSelectionService.getUserAvailableResumes(userId);
      return availableResumes.length > 0;
    } catch (error) {
      this.logger.warn(
        `Error checking existing resumes for user ${userId}`,
        error,
      );
      // Return false as safe default
      return false;
    }
  }

  /**
   * Validate specific resume ID exists for user
   */
  private async validateSpecificResume(
    userId?: string,
    resumeId?: string,
  ): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
    const result = {
      isValid: true,
      errors: [] as string[],
      warnings: [] as string[],
    };

    if (!userId || !resumeId) {
      result.isValid = false;
      result.errors.push(
        'User ID and Resume ID are required for specific resume validation',
      );
      return result;
    }

    try {
      const convertedUserContext = this.convertToResumeSelectionUserContext({
        userId,
        userType: 'freemium', // We'll determine actual type later
      } as UserContext);

      await this.resumeSelectionService.selectResume(convertedUserContext, {
        resumeId,
        useLatestResume: false,
      });

      result.warnings.push(`Using specific resume: ${resumeId}`);
    } catch (error) {
      result.isValid = false;
      if (error instanceof NotFoundException) {
        result.errors.push(
          `Resume with ID '${resumeId}' not found for this user`,
        );
      } else {
        this.logger.error(
          `Error validating resume ${resumeId} for user ${userId}`,
          error,
        );
        result.errors.push(`Unable to verify resume availability: ${resumeId}`);
      }
    }

    return result;
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
}
