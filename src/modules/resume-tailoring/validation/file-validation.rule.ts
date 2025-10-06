import { Injectable, Logger } from '@nestjs/common';
import {
  BaseValidationRule,
  ValidationRuleResult,
} from '../../../shared/modules/validation';
import { ResumeValidationContext } from '../interfaces/resume-validation-context.interface';

/**
 * File Validation Rule
 *
 * Validates uploaded resume files including format, size, and content validation.
 * This rule ensures that uploaded files meet all requirements for processing.
 */
@Injectable()
export class FileValidationRule extends BaseValidationRule<ResumeValidationContext> {
  protected readonly logger = new Logger(FileValidationRule.name);

  getRuleName(): string {
    return 'FileValidation';
  }

  getPriority(): number {
    return 60; // Medium priority - runs after user context validation
  }

  protected executeValidation(
    context: ResumeValidationContext,
  ): Promise<ValidationRuleResult> {
    this.logger.debug('Validating uploaded resume file');

    const errors: string[] = [];
    const warnings: string[] = [];

    const resumeFile = context.input?.resumeFile;

    // If no file is provided, this is not an error for this rule
    // The ResumeRequirementsValidationRule will handle whether file is required
    if (!resumeFile) {
      this.logger.debug('No file provided - skipping file validation');
      return Promise.resolve(this.createSuccessResult());
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

    // Additional file validation warnings
    if (resumeFile.size > 5 * 1024 * 1024) {
      // 5MB warning threshold
      warnings.push(
        'File size is large (>5MB) - this may affect processing speed',
      );
    }

    this.logger.debug(
      `File validation completed: ${errors.length} errors, ${warnings.length} warnings`,
    );

    return Promise.resolve(
      errors.length > 0
        ? this.createFailureResult(errors, warnings)
        : this.createSuccessResult(warnings),
    );
  }
}
