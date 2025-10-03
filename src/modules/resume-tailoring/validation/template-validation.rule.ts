import { Injectable, Logger } from '@nestjs/common';
import {
  BaseValidationRule,
  ValidationRuleResult,
} from '../../../shared/modules/validation';
import { ResumeValidationContext } from '../interfaces/resume-validation-context.interface';
import { ResumeTemplateService } from '../services/resume-templates.service';

/**
 * Template Validation Rule
 *
 * Validates that the specified resume template exists and is accessible.
 * This rule ensures that the template ID is valid and the template is available
 * for use in resume generation.
 */
@Injectable()
export class TemplateValidationRule extends BaseValidationRule<ResumeValidationContext> {
  protected readonly logger = new Logger(TemplateValidationRule.name);

  constructor(private readonly resumeTemplateService: ResumeTemplateService) {
    super();
  }

  getRuleName(): string {
    return 'TemplateValidation';
  }

  getPriority(): number {
    return 80; // Medium-high priority - runs after basic input validation
  }

  protected async executeValidation(
    context: ResumeValidationContext,
  ): Promise<ValidationRuleResult> {
    this.logger.debug(`Validating template: ${context.input?.templateId}`);

    const errors: string[] = [];
    const warnings: string[] = [];

    const templateId = context.input?.templateId;

    if (!templateId || typeof templateId !== 'string') {
      errors.push('Template ID is required and must be a string');
      return this.createFailureResult(errors);
    }

    if (templateId.trim().length === 0) {
      errors.push('Template ID cannot be empty');
      return this.createFailureResult(errors);
    }

    try {
      const template = await this.resumeTemplateService.getTemplateById(
        templateId.trim(),
      );

      if (!template) {
        errors.push(`Template with ID '${templateId}' not found`);
        return this.createFailureResult(errors);
      }

      // Additional template validation could go here
      // (e.g., template active status, user permissions, etc.)
      this.logger.debug(`Template ${templateId} validation successful`);

      return this.createSuccessResult(warnings);
    } catch (error) {
      this.logger.error(`Failed to validate template ${templateId}`, error);
      errors.push(`Unable to verify template availability: ${templateId}`);
      return this.createFailureResult(errors, warnings);
    }
  }
}
