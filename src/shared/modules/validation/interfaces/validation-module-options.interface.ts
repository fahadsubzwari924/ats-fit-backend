import { ValidationOrchestratorConfig } from './validation.interface';

// Validation module options interface moved from validation.module.ts
export interface ValidationModuleOptions {
  /**
   * Global validation configuration
   */
  config?: ValidationOrchestratorConfig;

  /**
   * Whether to make the validation services available globally
   */
  isGlobal?: boolean;
}
