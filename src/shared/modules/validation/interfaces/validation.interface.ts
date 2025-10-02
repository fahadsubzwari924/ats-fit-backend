/**
 * Generic Validation Framework Interfaces
 *
 * Provides a reusable, extensible validation architecture following SOLID principles.
 * This framework can be used by any feature module with minimal configuration.
 */

/**
 * Generic Validation Rule Interface
 *
 * Defines the contract for all validation rules following the Strategy pattern.
 * Each validation rule is responsible for a single validation concern.
 *
 * @template TContext - The type of validation context this rule operates on
 */
export interface IValidationRule<TContext = any> {
  /**
   * Execute validation rule
   * @param context - Validation context containing input and state
   * @returns Promise<ValidationRuleResult> - Structured validation result
   */
  validate(context: TContext): Promise<ValidationRuleResult>;

  /**
   * Get the priority of this validation rule (higher number = higher priority)
   * Rules with higher priority are executed first
   */
  getPriority(): number;

  /**
   * Get a descriptive name for this validation rule (for logging/debugging)
   */
  getRuleName(): string;

  /**
   * Optional: Check if this rule should be executed based on context
   * Allows for conditional rule execution
   */
  shouldExecute?(context: TContext): boolean | Promise<boolean>;
}

/**
 * Base Validation Context Interface
 *
 * Minimum contract that all validation contexts must implement.
 * Feature modules can extend this with their specific context data.
 */
export interface IValidationContext {
  /**
   * Unique identifier for this validation session (for logging/tracing)
   */
  sessionId?: string;

  /**
   * Optional metadata for this validation
   */
  metadata?: Record<string, any>;
}

/**
 * Validation Error
 *
 * Structured error with message and optional error code
 */
export interface ValidationError {
  /**
   * Human-readable error message
   */
  message: string;

  /**
   * Machine-readable error code for front-end translation
   */
  code?: string;
}

/**
 * Validation Result
 *
 * Structured result from validation execution
 */
export interface ValidationRuleResult {
  /**
   * Whether the validation passed
   */
  isValid: boolean;

  /**
   * Array of error messages if validation failed
   */
  errors: string[];

  /**
   * Array of structured errors with codes (enhanced version)
   */
  structuredErrors?: ValidationError[];

  /**
   * Optional warnings (non-blocking issues)
   */
  warnings?: string[];

  /**
   * Optional metadata about the validation execution
   */
  metadata?: {
    executionTimeMs?: number;
    ruleName?: string;
    [key: string]: any;
  };
}

/**
 * Validation Rule Metadata
 *
 * Contains information about a registered validation rule
 */
export interface ValidationRuleMetadata<TContext = any> {
  rule: IValidationRule<TContext>;
  priority: number;
  name: string;
  enabled: boolean;
}

/**
 * Validation Orchestrator Configuration
 *
 * Configuration options for the validation orchestrator
 */
export interface ValidationOrchestratorConfig {
  /**
   * Whether to stop at first validation failure (fail-fast)
   */
  failFast?: boolean;

  /**
   * Maximum time to spend on validation (in ms)
   */
  timeoutMs?: number;

  /**
   * Whether to include execution metrics in results
   */
  includeMetrics?: boolean;

  /**
   * Custom logger instance
   */
  logger?: {
    log: (message: string, context?: any) => void;
    warn: (message: string, context?: any) => void;
    error: (message: string, error?: any) => void;
  };
}

/**
 * Validation Orchestrator Result
 *
 * Comprehensive result from the validation orchestrator
 */
export interface ValidationOrchestratorResult {
  /**
   * Overall validation status
   */
  isValid: boolean;

  /**
   * All error messages from failed rules
   */
  errors: string[];

  /**
   * All structured errors with codes from failed rules
   */
  structuredErrors?: ValidationError[];

  /**
   * All warning messages from rules
   */
  warnings: string[];

  /**
   * Results from individual rules (if enabled in config)
   */
  ruleResults?: ValidationRuleResult[];

  /**
   * Execution metrics
   */
  metrics?: {
    totalExecutionTimeMs: number;
    rulesExecuted: number;
    rulesSkipped: number;
    failedAt?: string;
  };
}

/**
 * Validation Rule Factory Interface
 *
 * Factory for creating validation rules with dependency injection
 */
export interface IValidationRuleFactory<TContext = any> {
  /**
   * Create a validation rule instance
   */
  create<TRule extends IValidationRule<TContext>>(
    ruleClass: new (...args: any[]) => TRule,
    dependencies?: any[],
  ): TRule;
}

/**
 * Validation Service Interface
 *
 * High-level interface for feature modules to use validation
 */
export interface IValidationService<TContext extends IValidationContext = any> {
  /**
   * Validate a context using registered rules
   */
  validate(context: TContext): Promise<ValidationOrchestratorResult>;

  /**
   * Register a validation rule
   */
  registerRule(rule: IValidationRule<TContext>): void;

  /**
   * Unregister a validation rule by name
   */
  unregisterRule(ruleName: string): void;

  /**
   * Get information about registered rules
   */
  getRulesInfo(): ValidationRuleMetadata<TContext>[];

  /**
   * Enable or disable a specific rule
   */
  setRuleEnabled(ruleName: string, enabled: boolean): void;
}
