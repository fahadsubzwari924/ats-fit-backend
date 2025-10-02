import { Injectable } from '@nestjs/common';
import {
  IValidationService,
  IValidationRule,
  ValidationOrchestratorResult,
  ValidationRuleMetadata,
  IValidationContext,
  ValidationOrchestratorConfig,
} from '../interfaces/validation.interface';
import { ValidationOrchestrator } from './validation-orchestrator.service';

/**
 * Generic Validation Service
 *
 * High-level service that feature modules can use to implement validation.
 * This service provides a simple interface while leveraging the powerful
 * validation orchestrator underneath.
 *
 * Usage in feature modules:
 * 1. Extend IValidationContext for your specific context
 * 2. Create validation rules extending BaseValidationRule
 * 3. Inject this service and register your rules
 * 4. Call validate() with your context
 */
@Injectable()
export class GenericValidationService<TContext extends IValidationContext = any>
  implements IValidationService<TContext>
{
  private readonly orchestrator: ValidationOrchestrator<TContext>;

  constructor(config?: ValidationOrchestratorConfig) {
    this.orchestrator = new ValidationOrchestrator<TContext>(config);
  }

  /**
   * Validate a context using registered rules
   */
  async validate(context: TContext): Promise<ValidationOrchestratorResult> {
    return this.orchestrator.executeValidation(context);
  }

  /**
   * Register a validation rule
   */
  registerRule(rule: IValidationRule<TContext>): void {
    this.orchestrator.registerRule(rule);
  }

  /**
   * Register multiple validation rules at once
   */
  registerRules(rules: IValidationRule<TContext>[]): void {
    rules.forEach((rule) => this.registerRule(rule));
  }

  /**
   * Unregister a validation rule by name
   */
  unregisterRule(ruleName: string): boolean {
    return this.orchestrator.unregisterRule(ruleName);
  }

  /**
   * Get information about registered rules
   */
  getRulesInfo(): ValidationRuleMetadata<TContext>[] {
    return this.orchestrator.getRulesInfo();
  }

  /**
   * Enable or disable a specific rule
   */
  setRuleEnabled(ruleName: string, enabled: boolean): boolean {
    return this.orchestrator.setRuleEnabled(ruleName, enabled);
  }

  /**
   * Enable multiple rules at once
   */
  enableRules(ruleNames: string[]): void {
    ruleNames.forEach((ruleName) => this.setRuleEnabled(ruleName, true));
  }

  /**
   * Disable multiple rules at once
   */
  disableRules(ruleNames: string[]): void {
    ruleNames.forEach((ruleName) => this.setRuleEnabled(ruleName, false));
  }

  /**
   * Get count of registered rules
   */
  getRuleCount(): { total: number; enabled: number; disabled: number } {
    return this.orchestrator.getRuleCount();
  }

  /**
   * Clear all registered rules
   */
  clearAllRules(): void {
    this.orchestrator.clearAllRules();
  }

  /**
   * Check if a rule is registered
   */
  hasRule(ruleName: string): boolean {
    return this.getRulesInfo().some((rule) => rule.name === ruleName);
  }

  /**
   * Check if a rule is enabled
   */
  isRuleEnabled(ruleName: string): boolean {
    const ruleInfo = this.getRulesInfo().find((rule) => rule.name === ruleName);
    return ruleInfo?.enabled ?? false;
  }

  /**
   * Get enabled rules only
   */
  getEnabledRules(): ValidationRuleMetadata<TContext>[] {
    return this.getRulesInfo().filter((rule) => rule.enabled);
  }

  /**
   * Get disabled rules only
   */
  getDisabledRules(): ValidationRuleMetadata<TContext>[] {
    return this.getRulesInfo().filter((rule) => !rule.enabled);
  }
}
