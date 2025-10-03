import { Injectable, Logger } from '@nestjs/common';
import {
  IValidationRule,
  ValidationOrchestratorConfig,
  ValidationOrchestratorResult,
  ValidationRuleMetadata,
  ValidationRuleResult,
  IValidationContext,
  ValidationError,
} from '../interfaces/validation.interface';

/**
 * Generic Validation Orchestrator
 *
 * Orchestrates multiple validation rules using Chain of Responsibility pattern.
 * This service is completely generic and can be used by any feature module.
 *
 * Key Features:
 * - Dependency injection ready
 * - Priority-based rule execution
 * - Fail-fast or complete validation modes
 * - Performance monitoring
 * - Rule management (enable/disable, register/unregister)
 * - Type-safe and extensible
 */
@Injectable()
export class ValidationOrchestrator<TContext extends IValidationContext = any> {
  private readonly logger = new Logger(ValidationOrchestrator.name);
  private readonly registeredRules = new Map<
    string,
    ValidationRuleMetadata<TContext>
  >();
  private readonly config: Required<ValidationOrchestratorConfig>;

  constructor(config?: ValidationOrchestratorConfig) {
    this.config = {
      failFast: false,
      timeoutMs: 30000, // 30 seconds default
      includeMetrics: true,
      logger: this.logger,
      ...config,
    };
  }

  /**
   * Execute validation using all registered rules
   */
  async executeValidation(
    context: TContext,
  ): Promise<ValidationOrchestratorResult> {
    const startTime = Date.now();
    const sessionId = context.sessionId || this.generateSessionId();

    this.config.logger.log(`Starting validation session: ${sessionId}`);

    try {
      // Get enabled rules sorted by priority
      const rulesToExecute = this.getEnabledRulesSortedByPriority();

      if (rulesToExecute.length === 0) {
        this.config.logger.warn('No validation rules registered');
        return this.createEmptyResult(sessionId);
      }

      const result = await this.executeRules(
        context,
        rulesToExecute,
        sessionId,
      );

      const totalTime = Date.now() - startTime;
      this.config.logger.log(
        `Validation session ${sessionId} completed in ${totalTime}ms. Valid: ${result.isValid}`,
      );

      return result;
    } catch (error) {
      const totalTime = Date.now() - startTime;
      this.config.logger.error(
        `Validation session ${sessionId} failed after ${totalTime}ms`,
        error,
      );

      return {
        isValid: false,
        errors: ['Validation orchestrator encountered an internal error'],
        warnings: [],
        metrics: {
          totalExecutionTimeMs: totalTime,
          rulesExecuted: 0,
          rulesSkipped: 0,
        },
      };
    }
  }

  /**
   * Register a validation rule
   */
  registerRule(rule: IValidationRule<TContext>): void {
    const ruleName = rule.getRuleName();

    if (this.registeredRules.has(ruleName)) {
      this.config.logger.warn(`Overwriting existing rule: ${ruleName}`);
    }

    const metadata: ValidationRuleMetadata<TContext> = {
      rule,
      priority: rule.getPriority(),
      name: ruleName,
      enabled: true,
    };

    this.registeredRules.set(ruleName, metadata);
    this.config.logger.log(
      `Registered validation rule: ${ruleName} (priority: ${rule.getPriority()})`,
    );
  }

  /**
   * Unregister a validation rule
   */
  unregisterRule(ruleName: string): boolean {
    const existed = this.registeredRules.delete(ruleName);

    if (existed) {
      this.config.logger.log(`Unregistered validation rule: ${ruleName}`);
    } else {
      this.config.logger.warn(
        `Attempted to unregister non-existent rule: ${ruleName}`,
      );
    }

    return existed;
  }

  /**
   * Enable or disable a specific rule
   */
  setRuleEnabled(ruleName: string, enabled: boolean): boolean {
    const ruleMetadata = this.registeredRules.get(ruleName);

    if (!ruleMetadata) {
      this.config.logger.warn(`Cannot modify non-existent rule: ${ruleName}`);
      return false;
    }

    ruleMetadata.enabled = enabled;
    this.config.logger.log(
      `Rule ${ruleName} ${enabled ? 'enabled' : 'disabled'}`,
    );
    return true;
  }

  /**
   * Get information about registered rules
   */
  getRulesInfo(): ValidationRuleMetadata<TContext>[] {
    return Array.from(this.registeredRules.values()).map((metadata) => ({
      ...metadata,
      // Create a shallow copy to prevent external modifications
    }));
  }

  /**
   * Get count of registered rules
   */
  getRuleCount(): { total: number; enabled: number; disabled: number } {
    const rules = Array.from(this.registeredRules.values());
    return {
      total: rules.length,
      enabled: rules.filter((r) => r.enabled).length,
      disabled: rules.filter((r) => !r.enabled).length,
    };
  }

  /**
   * Clear all registered rules
   */
  clearAllRules(): void {
    const count = this.registeredRules.size;
    this.registeredRules.clear();
    this.config.logger.log(`Cleared ${count} validation rules`);
  }

  /**
   * Execute validation rules
   */
  private async executeRules(
    context: TContext,
    rules: ValidationRuleMetadata<TContext>[],
    sessionId: string,
  ): Promise<ValidationOrchestratorResult> {
    const errors: string[] = [];
    const structuredErrors: ValidationError[] = [];
    const warnings: string[] = [];
    const ruleResults: any[] = [];
    let rulesExecuted = 0;
    let rulesSkipped = 0;
    const startTime = Date.now();

    for (const ruleMetadata of rules) {
      // Check timeout
      if (Date.now() - startTime > this.config.timeoutMs) {
        this.config.logger.warn(
          `Validation timeout exceeded (${this.config.timeoutMs}ms) for session ${sessionId}`,
        );
        errors.push('Validation timeout exceeded');
        break;
      }

      try {
        const ruleStartTime = Date.now();
        const result = await ruleMetadata.rule.validate(context);
        const ruleExecutionTime = Date.now() - ruleStartTime;

        rulesExecuted++;

        // Collect results
        errors.push(...result.errors);
        if (result.structuredErrors) {
          structuredErrors.push(...result.structuredErrors);
        }
        if (result.warnings) {
          warnings.push(...result.warnings);
        }

        // Store individual rule result if metrics enabled
        if (this.config.includeMetrics) {
          ruleResults.push({
            ...result,
            metadata: {
              ...result.metadata,
              ruleName: ruleMetadata.name,
              executionTimeMs: ruleExecutionTime,
            },
          });
        }

        // Fail fast if configured and rule failed
        if (this.config.failFast && !result.isValid) {
          this.config.logger.log(
            `Fail-fast triggered by rule: ${ruleMetadata.name} in session ${sessionId}`,
          );
          break;
        }
      } catch (error) {
        rulesExecuted++;
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        errors.push(
          `Rule '${ruleMetadata.name}' execution failed: ${errorMessage}`,
        );

        this.config.logger.error(
          `Rule execution failed: ${ruleMetadata.name} in session ${sessionId}`,
          error,
        );

        // Fail fast on rule execution errors if configured
        if (this.config.failFast) {
          break;
        }
      }
    }

    rulesSkipped = rules.length - rulesExecuted;
    const totalExecutionTime = Date.now() - startTime;

    return {
      isValid: errors.length === 0,
      errors,
      structuredErrors:
        structuredErrors.length > 0 ? structuredErrors : undefined,
      warnings,
      ruleResults: this.config.includeMetrics
        ? (ruleResults as ValidationRuleResult[])
        : undefined,
      metrics: {
        totalExecutionTimeMs: totalExecutionTime,
        rulesExecuted,
        rulesSkipped,
        failedAt:
          errors.length > 0 ? rules[rulesExecuted - 1]?.name : undefined,
      },
    };
  }

  /**
   * Get enabled rules sorted by priority (descending)
   */
  private getEnabledRulesSortedByPriority(): ValidationRuleMetadata<TContext>[] {
    return Array.from(this.registeredRules.values())
      .filter((ruleMetadata) => ruleMetadata.enabled)
      .sort((a, b) => b.priority - a.priority); // Higher priority first
  }

  /**
   * Create empty validation result
   */
  private createEmptyResult(sessionId: string): ValidationOrchestratorResult {
    this.config.logger.warn(`No rules to execute for session ${sessionId}`);

    return {
      isValid: true, // No rules means no failures
      errors: [],
      warnings: ['No validation rules were executed'],
      metrics: {
        totalExecutionTimeMs: 0,
        rulesExecuted: 0,
        rulesSkipped: 0,
      },
    };
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    return `val_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
