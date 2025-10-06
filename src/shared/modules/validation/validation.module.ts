import { DynamicModule, Module, Provider } from '@nestjs/common';
import { ValidationOrchestrator } from './services/validation-orchestrator.service';
import { GenericValidationService } from './services/generic-validation.service';
import { IValidationContext } from './interfaces/validation.interface';
import { ValidationModuleOptions } from './interfaces/validation-module-options.interface';

/**
 * Generic Validation Module
 *
 * Provides a reusable validation framework that any feature module can use.
 * This module follows SOLID principles and is completely decoupled from
 * specific business logic.
 *
 * Usage:
 * 1. Import in your feature module
 * 2. Define your validation context interface extending IValidationContext
 * 3. Create validation rules extending BaseValidationRule
 * 4. Inject GenericValidationService and register your rules
 */
@Module({})
export class ValidationModule {
  /**
   * Create a validation module for a specific context type
   */
  static forFeature<TContext extends IValidationContext = any>(
    options: ValidationModuleOptions = {},
  ): DynamicModule {
    const providers: Provider[] = [
      {
        provide: ValidationOrchestrator,
        useFactory: () => new ValidationOrchestrator<TContext>(options.config),
      },
      {
        provide: GenericValidationService,
        useFactory: () => {
          const service = new GenericValidationService<TContext>(
            options.config,
          );
          return service;
        },
      },
    ];

    return {
      module: ValidationModule,
      providers,
      exports: providers,
      global: options.isGlobal || false,
    };
  }

  /**
   * Create a root validation module (typically used in SharedModule)
   */
  static forRoot(options: ValidationModuleOptions = {}): DynamicModule {
    return {
      module: ValidationModule,
      providers: [
        ValidationOrchestrator,
        GenericValidationService,
        ...(options.config
          ? [
              {
                provide: 'VALIDATION_CONFIG',
                useValue: options.config,
              },
            ]
          : []),
      ],
      exports: [ValidationOrchestrator, GenericValidationService],
      global: options.isGlobal || false,
    };
  }
}
