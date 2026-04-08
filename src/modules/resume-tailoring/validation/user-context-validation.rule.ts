import { Injectable, Logger } from '@nestjs/common';
import {
  BaseValidationRule,
  ValidationRuleResult,
} from '../../../shared/modules/validation';
import { ResumeValidationContext } from '../interfaces/resume-validation-context.interface';

@Injectable()
export class UserContextValidationRule extends BaseValidationRule<ResumeValidationContext> {
  protected readonly logger = new Logger(UserContextValidationRule.name);

  getRuleName(): string {
    return 'UserContextValidation';
  }

  getPriority(): number {
    return 100;
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

    const validUserTypes = ['freemium', 'premium'];
    if (!validUserTypes.includes(userContext.userType)) {
      errors.push(
        `Invalid user type: ${userContext.userType}. Must be one of: ${validUserTypes.join(', ')}`,
      );
    }

    if (!userContext.userId || typeof userContext.userId !== 'string') {
      errors.push('User ID is required');
    }

    if (userContext.userId && !this.isValidUUID(userContext.userId)) {
      errors.push('User ID must be a valid UUID format');
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

  protected isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }
}
