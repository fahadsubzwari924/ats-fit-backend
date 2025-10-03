import { Logger } from '@nestjs/common';
import {
  IValidationRule,
  ValidationRuleResult,
  IValidationContext,
  ValidationError,
} from '../interfaces/validation.interface';

/**
 * Abstract Base Validation Rule
 *
 * Provides common functionality for all validation rules following the Template Method pattern.
 * Concrete rules only need to implement the core validation logic.
 *
 * Benefits:
 * - Consistent error handling and logging
 * - Built-in performance monitoring
 * - Extensible hook methods for advanced scenarios
 * - Type-safe implementation
 */
export abstract class BaseValidationRule<
  TContext extends IValidationContext = any,
> implements IValidationRule<TContext>
{
  protected readonly logger: Logger;

  constructor(loggerContext?: string) {
    this.logger = new Logger(loggerContext || this.constructor.name);
  }

  /**
   * Template method that orchestrates the validation process
   * Final implementation that cannot be overridden
   */
  async validate(context: TContext): Promise<ValidationRuleResult> {
    const startTime = Date.now();
    const ruleName = this.getRuleName();

    try {
      // Pre-validation hook
      await this.beforeValidation();

      // Check if rule should execute
      if (!this.shouldExecute()) {
        return this.createSkippedResult(ruleName, Date.now() - startTime);
      }

      // Execute core validation logic
      const result = await this.executeValidation(context);

      // Post-validation hook
      await this.afterValidation();

      // Add metadata
      const enrichedResult = this.enrichResult(
        result,
        ruleName,
        Date.now() - startTime,
      );

      this.logValidationResult(enrichedResult);

      return enrichedResult;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.logger.error(`Validation rule ${ruleName} failed`, error);

      return this.createErrorResult(
        error instanceof Error ? error.message : 'Unknown validation error',
        ruleName,
        executionTime,
      );
    }
  }

  /**
   * Abstract method for core validation logic
   * Must be implemented by concrete validation rules
   */
  protected abstract executeValidation(
    context: TContext,
  ): Promise<ValidationRuleResult>;

  /**
   * Abstract method for rule priority
   * Must be implemented by concrete validation rules
   */
  public abstract getPriority(): number;

  /**
   * Abstract method for rule name
   * Must be implemented by concrete validation rules
   */
  public abstract getRuleName(): string;

  /**
   * Hook method: Called before validation execution
   * Can be overridden by subclasses for setup logic
   */
  protected async beforeValidation(): Promise<void> {
    // Default implementation does nothing
    // Subclasses can override for setup logic and use context parameter if needed
  }

  /**
   * Hook method: Called after validation execution
   * Can be overridden by subclasses for cleanup logic
   */
  protected async afterValidation(): Promise<void> {
    // Default implementation does nothing
    // Subclasses can override for cleanup logic with their own parameters
  }

  /**
   * Conditional execution check
   * Can be overridden by subclasses for conditional logic
   */
  public shouldExecute(): boolean {
    // Default implementation always executes
    // Subclasses can override for conditional logic and use context parameter if needed
    return true;
  }

  /**
   * Create a successful validation result
   */
  protected createSuccessResult(warnings?: string[]): ValidationRuleResult {
    return {
      isValid: true,
      errors: [],
      warnings: warnings || [],
    };
  }

  /**
   * Create a failed validation result
   */
  protected createFailureResult(
    errors: string | string[],
    warnings?: string[],
  ): ValidationRuleResult {
    return {
      isValid: false,
      errors: Array.isArray(errors) ? errors : [errors],
      warnings: warnings || [],
    };
  }

  /**
   * Create a failed validation result with structured errors (includes error codes)
   */
  protected createStructuredFailureResult(
    structuredErrors: ValidationError | ValidationError[],
    warnings?: string[],
  ): ValidationRuleResult {
    const errorsArray = Array.isArray(structuredErrors)
      ? structuredErrors
      : [structuredErrors];

    return {
      isValid: false,
      errors: errorsArray.map((error) => error.message),
      structuredErrors: errorsArray,
      warnings: warnings || [],
    };
  }

  /**
   * Create a skipped validation result
   */
  private createSkippedResult(
    ruleName: string,
    executionTime: number,
  ): ValidationRuleResult {
    return {
      isValid: true,
      errors: [],
      warnings: [],
      metadata: {
        ruleName,
        executionTimeMs: executionTime,
        skipped: true,
      },
    };
  }

  /**
   * Create an error validation result
   */
  private createErrorResult(
    error: string,
    ruleName: string,
    executionTime: number,
  ): ValidationRuleResult {
    return {
      isValid: false,
      errors: [`Validation rule execution failed: ${error}`],
      warnings: [],
      metadata: {
        ruleName,
        executionTimeMs: executionTime,
        error: true,
      },
    };
  }

  /**
   * Enrich result with metadata
   */
  private enrichResult(
    result: ValidationRuleResult,
    ruleName: string,
    executionTime: number,
  ): ValidationRuleResult {
    return {
      ...result,
      metadata: {
        ...result.metadata,
        ruleName,
        executionTimeMs: executionTime,
      },
    };
  }

  /**
   * Log validation result
   */
  private logValidationResult(result: ValidationRuleResult): void {
    const { ruleName, executionTimeMs } = result.metadata || {};
    const status = result.isValid ? 'PASSED' : 'FAILED';

    if (result.isValid) {
      this.logger.log(`${ruleName} ${status} (${executionTimeMs}ms)`);

      if (result.warnings && result.warnings.length > 0) {
        this.logger.warn(`${ruleName} warnings:`, result.warnings);
      }
    } else {
      this.logger.warn(
        `${ruleName} ${status} (${executionTimeMs}ms): ${result.errors.join(', ')}`,
      );
    }
  }

  /**
   * Utility method for safe property access
   */
  protected safeGet<T>(
    obj: unknown,
    path: string,
    defaultValue?: T,
  ): T | undefined {
    try {
      if (!obj || typeof obj !== 'object') {
        return defaultValue;
      }

      let current = obj as Record<string, unknown>;
      const keys = path.split('.');

      for (const key of keys) {
        if (current && typeof current === 'object' && key in current) {
          current = current[key] as Record<string, unknown>;
        } else {
          return defaultValue;
        }
      }

      return current !== undefined ? (current as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  /**
   * Utility method for type checking
   */
  protected isValidType(value: any, type: string): boolean {
    if (type === 'array') {
      return Array.isArray(value);
    }

    if (type === 'object') {
      return (
        value !== null && typeof value === 'object' && !Array.isArray(value)
      );
    }

    return typeof value === type;
  }

  /**
   * Utility method for UUID validation
   */
  protected isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Utility method for string validation
   */
  protected validateString(
    value: any,
    name: string,
    options?: {
      required?: boolean;
      minLength?: number;
      maxLength?: number;
      pattern?: RegExp;
    },
  ): string[] {
    const errors: string[] = [];
    const opts = options || {};

    if (opts.required && (!value || typeof value !== 'string')) {
      errors.push(`${name} is required and must be a string`);
      return errors;
    }

    if (value && typeof value === 'string') {
      const trimmed = value.trim();

      if (opts.minLength && trimmed.length < opts.minLength) {
        errors.push(
          `${name} must be at least ${opts.minLength} characters long`,
        );
      }

      if (opts.maxLength && trimmed.length > opts.maxLength) {
        errors.push(`${name} cannot exceed ${opts.maxLength} characters`);
      }

      if (opts.pattern && !opts.pattern.test(trimmed)) {
        errors.push(`${name} format is invalid`);
      }
    }

    return errors;
  }
}
