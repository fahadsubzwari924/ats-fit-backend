import { Injectable, Logger } from '@nestjs/common';
import {
  BaseValidationRule,
  ValidationRuleResult,
} from '../../../shared/modules/validation';
import { ResumeValidationContext } from '../interfaces/resume-validation-context.interface';

/**
 * User Context Validation Rule
 *
 * Validates user context information including user type, IDs, and permissions.
 * This rule ensures that the user context is properly structured and contains
 * all required information for the user type.
 */
@Injectable()
export class UserContextValidationRule extends BaseValidationRule<ResumeValidationContext> {
  protected readonly logger = new Logger(UserContextValidationRule.name);

  getRuleName(): string {
    return 'UserContextValidation';
  }

  getPriority(): number {
    return 100; // High priority - runs early
  }

  protected executeValidation(
    context: ResumeValidationContext,
  ): Promise<ValidationRuleResult> {
    this.logger.debug(`Validating user context for ${context.user?.type} user`);

    const errors: string[] = [];
    const warnings: string[] = [];

    const userContext = context.userContext;

    if (!userContext || typeof userContext !== 'object') {
      errors.push('User context is required and must be an object');
      return Promise.resolve(this.createFailureResult(errors));
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

    this.logger.debug(
      `User context validation completed: ${errors.length} errors found`,
    );

    return Promise.resolve(
      errors.length > 0
        ? this.createFailureResult(errors, warnings)
        : this.createSuccessResult(warnings),
    );
  }

  /**
   * Basic UUID validation (overrides base class protected method)
   */
  protected isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}
