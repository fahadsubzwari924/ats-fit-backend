# Validation Module Documentation

## Overview

The Validation Module is a **generic, reusable validation framework** built following **SOLID principles**. It provides structured validation logic across feature modules with priority-based rule execution, error code support, and comprehensive metrics.

## Architecture Flow

```
Feature Module Service
       │
       ▼
GenericValidationService
       │
       ▼
ValidationOrchestrator (Chain of Responsibility)
       │
       ▼
BaseValidationRule (Template Method)
  │    │    │
Rule1 Rule2 Rule3 (Priority: 100→90→80)
```

## How to Use in Any Module

### 1. Define Your Context Interface

```typescript
// your-module/interfaces/your-validation-context.interface.ts
import { IValidationContext } from '../../../shared/modules/validation';

export interface YourValidationContext extends IValidationContext {
  input: {
    requiredField: string;
    optionalField?: number;
  };
  userContext: {
    userId?: string;
    userType: 'guest' | 'premium';
  };
}
```

### 2. Create Validation Rules

```typescript
// your-module/validation/your-validation.rule.ts
import { BaseValidationRule } from '../../../shared/modules/validation';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

export class YourValidationRule extends BaseValidationRule<YourValidationContext> {
  getRuleName(): string {
    return 'YourValidationRule';
  }
  getPriority(): number {
    return 100;
  } // Higher = executed first

  protected async executeValidation(
    context: YourValidationContext,
  ): Promise<ValidationRuleResult> {
    if (!context.input.requiredField) {
      return this.createStructuredFailureResult({
        message: 'Required field is missing',
        code: ERROR_CODES.REQUIRED_FIELD_MISSING,
      });
    }
    return this.createSuccessResult();
  }
}
```

### 3. Set Up Module

```typescript
// your-module/your-module.module.ts
@Module({
  imports: [
    ValidationModule.forFeature({
      config: { failFast: false, timeoutMs: 10000 },
    }),
  ],
  providers: [YourValidationService, YourValidationRule],
})
export class YourModule {}
```

### 4. Create Validation Service

```typescript
// your-module/services/your-validation.service.ts
@Injectable()
export class YourValidationService implements OnModuleInit {
  constructor(
    private readonly validationService: GenericValidationService<YourValidationContext>,
    private readonly yourValidationRule: YourValidationRule,
  ) {}

  onModuleInit() {
    this.validationService.registerRules([this.yourValidationRule]);
  }

  async validateOperation(input: any, userContext: any) {
    const context: YourValidationContext = { input, userContext };
    return this.validationService.validate(context);
  }
}
```

### 5. Use in Business Logic

```typescript
// your-module/services/your-main.service.ts
@Injectable()
export class YourMainService {
  constructor(private readonly validationService: YourValidationService) {}

  async processOperation(input: any, userContext: any) {
    const result = await this.validationService.validateOperation(
      input,
      userContext,
    );

    if (!result.isValid) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.errors,
        structuredErrors: result.structuredErrors, // For frontend translation
      });
    }

    return this.executeBusinessLogic(input, userContext);
  }
}
```
