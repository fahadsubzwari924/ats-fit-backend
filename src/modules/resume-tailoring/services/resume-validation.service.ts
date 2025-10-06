import { Injectable, Logger } from '@nestjs/common';
import { GenericValidationService } from '../../../shared/modules/validation';
import { ResumeValidationContext } from '../interfaces/resume-validation-context.interface';
import { BasicInputValidationRule } from '../validation/basic-input-validation.rule';
import { UserContextValidationRule } from '../validation/user-context-validation.rule';
import { TemplateValidationRule } from '../validation/template-validation.rule';
import { FileValidationRule } from '../validation/file-validation.rule';
import { ResumeRequirementsValidationRule } from '../validation/resume-requirements-validation.rule';
import { ResumeGenerationInput } from '../interfaces/resume-generation.interface';
import { StructuredValidationException } from '../exceptions/structured-validation.exception';

/**
 * Resume Validation Service V2
 *
 * Demonstrates how to use the generic validation framework in a feature module.
 * This service is much cleaner and more maintainable than the previous approach.
 *
 * Benefits of this approach:
 * - Separation of concerns (each rule handles one validation aspect)
 * - Easy to test individual rules
 * - Easy to add/remove/modify rules without touching other code
 * - Reusable validation utilities
 * - Type-safe validation contexts
 * - Built-in performance monitoring and logging
 */
@Injectable()
export class ResumeValidationService {
  private readonly logger = new Logger(ResumeValidationService.name);
  private readonly validationService: GenericValidationService<ResumeValidationContext>;

  constructor(
    private readonly basicInputValidationRule: BasicInputValidationRule,
    private readonly userContextValidationRule: UserContextValidationRule,
    private readonly templateValidationRule: TemplateValidationRule,
    private readonly fileValidationRule: FileValidationRule,
    private readonly resumeRequirementsValidationRule: ResumeRequirementsValidationRule,
  ) {
    // Initialize the generic validation service with our specific context type
    this.validationService =
      new GenericValidationService<ResumeValidationContext>({
        failFast: false, // Continue validation even if one rule fails
        timeoutMs: 30000, // 30 second timeout
        includeMetrics: true, // Include performance metrics
        logger: this.logger,
      });

    // Register validation rules
    this.registerValidationRules();
  }

  /**
   * Validate resume generation input (compatible with old interface)
   */
  async validateGenerationRequest(input: ResumeGenerationInput): Promise<{
    isValid: boolean;
    requiresFileUpload: boolean;
    hasExistingResumes: boolean;
    templateExists: boolean;
    validationErrors: string[];
  }> {
    this.logger.log(
      'Starting resume generation validation (compatibility mode)',
    );

    // Create validation context from input
    const context: ResumeValidationContext = {
      sessionId: `resume_val_${Date.now()}`,
      input: {
        jobDescription: input.jobDescription,
        jobPosition: input.jobPosition,
        companyName: input.companyName,
        templateId: input.templateId,
        resumeId: input.resumeId,
        resumeFile: input.resumeFile,
      },
      userContext: input.userContext,
      user: {
        id: input.userContext.userId,
        type: input.userContext.userType === 'guest' ? 'guest' : 'registered',
      },
      metadata: {
        source: 'resume-generation-v2',
        timestamp: new Date(),
      },
    };

    // Execute validation
    const result = await this.validationService.validate(context);

    this.logger.log(
      `Validation completed: ${result.isValid ? 'VALID' : 'INVALID'} ` +
        `(${result.metrics?.totalExecutionTimeMs}ms, ${result.metrics?.rulesExecuted} rules)`,
    );

    if (!result.isValid) {
      this.logger.warn('Validation errors:', result.errors);

      // If we have structured errors with error codes, throw structured exception
      if (result.structuredErrors && result.structuredErrors.length > 0) {
        throw new StructuredValidationException(result.structuredErrors);
      }
    }

    if (result.warnings.length > 0) {
      this.logger.warn('Validation warnings:', result.warnings);
    }

    // Extract compatibility information from validation context
    const userContext = input.userContext;
    const requiresFileUpload =
      userContext.userType === 'guest' || !input.resumeId;
    const hasExistingResumes =
      userContext.userType !== 'guest' && !!input.resumeId;
    const templateExists = !result.errors.some(
      (error) => error.includes('Template') && error.includes('not found'),
    );

    return {
      isValid: result.isValid,
      requiresFileUpload,
      hasExistingResumes,
      templateExists,
      validationErrors: result.errors,
    };
  }

  /**
   * Validate resume generation input (new interface)
   */
  async validateResumeGeneration(input: ResumeGenerationInput): Promise<{
    isValid: boolean;
    errors: string[];
    warnings: string[];
    metrics?: any;
  }> {
    this.logger.log('Starting resume generation validation');

    // Create validation context from input
    const context: ResumeValidationContext = {
      sessionId: `resume_val_${Date.now()}`,
      input: {
        jobDescription: input.jobDescription,
        jobPosition: input.jobPosition,
        companyName: input.companyName,
        templateId: input.templateId,
        resumeId: input.resumeId,
        resumeFile: input.resumeFile,
      },
      userContext: input.userContext,
      user: {
        id: input.userContext.userId,
        type: input.userContext.userType === 'guest' ? 'guest' : 'registered',
      },
      metadata: {
        source: 'resume-generation-v2',
        timestamp: new Date(),
      },
    };

    // Execute validation
    const result = await this.validationService.validate(context);

    this.logger.log(
      `Validation completed: ${result.isValid ? 'VALID' : 'INVALID'} ` +
        `(${result.metrics?.totalExecutionTimeMs}ms, ${result.metrics?.rulesExecuted} rules)`,
    );

    if (!result.isValid) {
      this.logger.warn('Validation errors:', result.errors);
    }

    if (result.warnings.length > 0) {
      this.logger.warn('Validation warnings:', result.warnings);
    }

    return {
      isValid: result.isValid,
      errors: result.errors,
      warnings: result.warnings,
      metrics: result.metrics,
    };
  }

  /**
   * Get validation rules information for debugging
   */
  getValidationRulesInfo() {
    return this.validationService.getRulesInfo();
  }

  /**
   * Enable or disable a specific validation rule
   */
  setRuleEnabled(ruleName: string, enabled: boolean): boolean {
    return this.validationService.setRuleEnabled(ruleName, enabled);
  }

  /**
   * Register all validation rules
   */
  private registerValidationRules(): void {
    this.logger.log('Registering validation rules');

    // Register all validation rules in priority order
    this.validationService.registerRule(this.basicInputValidationRule); // Priority 100
    this.validationService.registerRule(this.userContextValidationRule); // Priority 100
    this.validationService.registerRule(this.templateValidationRule); // Priority 80
    this.validationService.registerRule(this.fileValidationRule); // Priority 60
    this.validationService.registerRule(this.resumeRequirementsValidationRule); // Priority 40

    const rulesCount = this.validationService.getRuleCount();
    this.logger.log(
      `Registered ${rulesCount.total} validation rules ` +
        `(${rulesCount.enabled} enabled, ${rulesCount.disabled} disabled)`,
    );
  }
}
