import { Injectable } from '@nestjs/common';
import {
  BaseValidationRule,
  ValidationRuleResult,
  ValidationPriorities,
} from '../../../shared/modules/validation';
import { ResumeValidationContext } from '../interfaces/resume-validation-context.interface';

/**
 * Basic Input Validation Rule
 *
 * Example of how to create a validation rule using the generic framework.
 * This rule validates basic input parameters for resume generation.
 *
 * Features demonstrated:
 * - Extending BaseValidationRule for common functionality
 * - Type-safe validation context
 * - Reusable validation utilities
 * - Proper error messaging
 */
@Injectable()
export class BasicInputValidationRule extends BaseValidationRule<ResumeValidationContext> {
  /**
   * Execute the core validation logic
   */
  protected executeValidation(
    context: ResumeValidationContext,
  ): Promise<ValidationRuleResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate job description
    const jobDescErrors = this.validateString(
      context.input.jobDescription,
      'Job description',
      {
        required: true,
        minLength: 50,
        maxLength: 15000,
      },
    );
    errors.push(...jobDescErrors);

    // Validate job position
    const positionErrors = this.validateString(
      context.input.jobPosition,
      'Job position',
      {
        required: true,
        minLength: 2,
        maxLength: 200,
      },
    );
    errors.push(...positionErrors);

    // Validate company name
    const companyErrors = this.validateString(
      context.input.companyName,
      'Company name',
      {
        required: true,
        minLength: 2,
        maxLength: 200,
      },
    );
    errors.push(...companyErrors);

    // Validate template ID
    const templateErrors = this.validateString(
      context.input.templateId,
      'Template ID',
      {
        required: true,
        minLength: 1,
      },
    );
    errors.push(...templateErrors);

    // Add warnings for edge cases
    if (
      context.input.jobDescription &&
      context.input.jobDescription.length > 10000
    ) {
      warnings.push(
        'Job description is very long - consider summarizing key requirements',
      );
    }

    return Promise.resolve(
      errors.length > 0
        ? this.createFailureResult(errors, warnings)
        : this.createSuccessResult(warnings),
    );
  }

  /**
   * Get rule priority - higher numbers execute first
   */
  getPriority(): number {
    return ValidationPriorities.INPUT_SANITIZATION;
  }

  /**
   * Get descriptive rule name
   */
  getRuleName(): string {
    return 'BasicInputValidation';
  }

  /**
   * Conditional execution - always execute for this rule
   */
  shouldExecute(): boolean {
    // Always execute basic input validation
    return true;
  }
}
