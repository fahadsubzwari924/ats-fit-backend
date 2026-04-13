# Conventions — ats-fit-backend


## TypeScript

- Enable `strict`; avoid `any`; prefer `unknown` + narrowing
- Explicit return types on exported functions and public class methods
- Use discriminated unions for variant results instead of loose strings
- Prefer `import type` for type-only imports
- Co-locate tests as `*.test.ts` or `__tests__/` per repo standard
- Model domain concepts with types/interfaces, not raw primitives — `UserId` not `string`, `Price` not `number`

### Type, interface, and enum placement

Never define types inline in implementation files. Place them in dedicated files and import:

| What | Where | Filename pattern |
|------|-------|-----------------|
| Domain/business interfaces | `src/domain/` or `features/<name>/` | `<concept>.interface.ts` |
| Shared types across features | `src/types/` | `<concept>.types.ts` |
| Request/response shapes | Next to controller or DTO | `<resource>.dto.ts` or `<resource>.schema.ts` |
| Enums | `src/types/enums/` or `features/<name>/` | `<concept>.enum.ts` |
| Constants (typed) | `src/constants/` | `<domain>.constants.ts` |

One concept per file. If a type is used only within one feature, keep it in that feature folder. If two+ features share it, promote to `src/types/`.













## NestJS

### Module directory structure

Every feature is a self-contained module. All type definitions live in dedicated files, never inline:

```
src/
  modules/
    orders/
      orders.module.ts
      orders.controller.ts        ← thin: parse, validate, delegate
      orders.service.ts           ← business logic only
      orders.repository.ts        ← DB queries only
      dto/
        create-order.dto.ts       ← one DTO per request shape
        update-order.dto.ts
      interfaces/
        order.interface.ts        ← IOrder, IOrderItem
      enums/
        order-status.enum.ts      ← OrderStatus, OrderPriority
      entities/
        order.entity.ts           ← TypeORM mapping, no business methods
  common/
    constants/                    ← shared named constants
    types/                        ← shared interfaces used by 2+ modules
    decorators/
    guards/
    pipes/
```

### Layer separation (required)

| Layer | File pattern | Responsibility |
|-------|-------------|----------------|
| Controller | `*.controller.ts` | Route handling, DTO validation via class-validator, delegate to service |
| Service | `*.service.ts` | Business logic; inject repository or TypeORM entity manager |
| Repository | `*.repository.ts` | Encapsulate queries; never expose ORM details to service callers |
| DTO | `dto/*.dto.ts` | Validate + document request shape; `class-validator` decorators |
| Interface | `interfaces/*.interface.ts` | Domain contracts; never define inline in service/controller |
| Enum | `enums/*.enum.ts` | Status values, event names, role strings; never inline string literals |
| Entity | `entities/*.entity.ts` | DB mapping only; no business methods |

### Constants and configuration

- Use `@nestjs/config` with typed `ConfigService`; no raw `process.env` in services or controllers
- Shared constants in `src/common/constants/`; module-scoped constants alongside the module

### Validation

- `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true` globally — strip undeclared fields by default
- Typed DTOs with decorators (`@IsString()`, `@IsUUID()`, `@IsInt()`, `@Min()`) on every incoming field
- Custom pipes for domain-level validation (e.g. entity existence checks) — keep controllers thin


## Cross-cutting

- One logical change per commit when possible
- Update public docs when behavior visible to users changes
