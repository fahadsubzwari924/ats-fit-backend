// Core interfaces
export * from './interfaces/validation.interface';

// Base classes
export { BaseValidationRule } from './services/base-validation-rule';

// Services
export { ValidationOrchestrator } from './services/validation-orchestrator.service';
export { GenericValidationService } from './services/generic-validation.service';

// Module
export { ValidationModule } from './validation.module';
export { ValidationModuleOptions } from './interfaces/validation-module-options.interface';

// Utility types for common validation contexts
import { IValidationContext } from './interfaces/validation.interface';

export interface CommonValidationContext extends IValidationContext {
  /**
   * User information for the validation
   */
  user?: {
    id?: string;
    type: 'guest' | 'registered';
    plan?: 'freemium' | 'premium';
  };

  /**
   * Request information
   */
  request?: {
    ip?: string;
    userAgent?: string;
    timestamp?: Date;
  };
}

// Common validation priorities (feature modules can use or define their own)
export const ValidationPriorities = {
  AUTHENTICATION: 1000, // Highest - check if user is authenticated
  AUTHORIZATION: 900, // Check permissions
  RATE_LIMITING: 800, // Rate limiting checks
  INPUT_SANITIZATION: 700, // Clean and validate inputs
  BUSINESS_RULES: 600, // Core business logic validation
  DATA_INTEGRITY: 500, // Database constraints, referential integrity
  EXTERNAL_SERVICES: 400, // Third-party service availability
  PERFORMANCE: 300, // Performance-related validations
  LOGGING: 200, // Audit and logging validations
  NOTIFICATIONS: 100, // Notification validations
} as const;

// Utility function to create a validation context with common fields
export function createValidationContext<T extends CommonValidationContext>(
  data: Omit<T, 'sessionId'>,
  sessionId?: string,
): T {
  return {
    ...data,
    sessionId:
      sessionId ||
      `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
  } as T;
}
