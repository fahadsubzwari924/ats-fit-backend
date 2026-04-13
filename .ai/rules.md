# Coding rules — ats-fit-backend

## Stack

| Field | Value |
|-------|-------|
| Language | TypeScript |
| Framework | NestJS |
| Database | SQL (TypeORM) |
| Test | `npm run test` |
| Lint | `npm run lint` |
| Build | `npm run build` |

## Token efficiency (assistant)

| # | Rule |
|---|------|
| 1 | Read only files needed for the current task; prefer ripgrep over opening whole trees |
| 2 | Summarize long outputs; paste minimal excerpts with path:line |
| 3 | Do not repeat `.ai/` or `docs/` content in chat—cite paths |
| 4 | Propose edits in small batches; one concern per patch where possible |
| 5 | Stop when success criteria are met; avoid scope creep |
| 6 | Ask one clarifying question only when blocked |

## Engineering principles

| Principle | Rule |
|-----------|------|
| SRP | One class/module = one reason to change — extract when a file does 2+ unrelated things |
| OCP | Extend behavior via composition or new modules, not by editing existing logic paths |
| DIP | Depend on interfaces/abstractions at layer boundaries; inject concrete implementations |
| DRY | Extract once it appears **3+** times; keep one source of truth per concept |
| KISS | Solve the problem in front of you — no clever abstractions for hypothetical cases |
| YAGNI | Do not add code for requirements that do not exist **right now** |

## Naming

- **Use business/domain names, not technical terms** — names describe *what the concept means in the business*, not how it is implemented

| Instead of | Use |
|------------|-----|
| `DataService`, `InfoHandler`, `Manager` | `OrderFulfillmentService`, `PaymentWebhookHandler`, `SubscriptionManager` |
| `processData()`, `handleInfo()`, `doStuff()` | `chargeCustomer()`, `sendWelcomeEmail()`, `archiveExpiredInvoices()` |
| `data`, `result`, `response`, `obj`, `item` | `invoice`, `createdUser`, `paymentIntent`, `activeSubscription` |
| `utils.ts`, `helpers.ts`, `common.ts` | `date-formatter.ts`, `currency-converter.ts`, `slug-generator.ts` |
| `IData`, `TInfo`, `EStatus` | `Invoice`, `UserProfile`, `OrderStatus` |

- Name booleans `is/has/should/can`; avoid `data`/`info`/`result` without domain context
- File names mirror the primary export's business role (`order-fulfillment.service.ts`, not `service.ts`)

## Style

- Prefer pure functions, early returns, shallow nesting (max 3 levels)
- Max **200** lines per file; split when exceeded
- Max **50** lines per function; extract helpers
- No commented-out code in commits

## Architecture

- Feature-based folders: `features/<name>/{api,ui,lib,types}`
- **Layer rule:** entry (router/controller) → application (service/use-case) → domain → infrastructure (DB/3rd-party); dependencies point inward only
- Keep framework adapters at the edges; core logic framework-agnostic
- No direct DB/infrastructure calls from controllers or route handlers
- **Type placement rule:** interfaces, types, and enums go in dedicated type files (`types.ts`, `interfaces.ts`, `enums.ts`, or `<concept>.types.ts`) — never defined inline in implementation files (services, controllers, repositories)
- **File placement rule:** before creating a file, decide its layer, feature area, and responsibility, then place it at the matching path — see `docs/CONVENTIONS.md` for stack-specific structure

## Load these docs on demand

| Topic | File |
|-------|------|
| System shape | `docs/ARCHITECTURE.md` |
| Stack conventions | `docs/CONVENTIONS.md` |
| Tests | `docs/TESTING-STRATEGY.md` |
| HTTP API | `docs/API-PATTERNS.md` |
| Errors | `docs/ERROR-HANDLING.md` |
| Security | `docs/SECURITY.md` |

## Git

- Conventional commits: `type(scope): summary` (types: feat, fix, docs, refactor, test, chore)
- Branch names: `type/short-description` or `issue-123-short-description`
- PRs: purpose, risk, test plan, rollback

## Anti-patterns

1. Do not add global mutable singletons for domain state
2. Do not catch errors without handling or rethrow with context
3. Do not commit secrets, tokens, or `.env*` contents
4. Do not skip tests for new behavior unless explicitly out of scope
5. Do not widen public API surface without a documented need
6. Do not mix formatting-only changes with functional changes
7. Do not depend on unspecified order where the domain requires stability
8. Do not silence linter rules project-wide to land a change
9. **No magic values** — never hard-code strings, numbers, or URLs inline; extract to named constants or config (`src/constants/`, `src/config/`, env vars)
10. **No logic in route/controller handlers** — a handler parses the request, calls a service, and returns the response; all business logic belongs in services
11. **Validate at every layer boundary** — parse and reject invalid inputs at the entry point (route/controller) before passing to the domain; services trust their inputs but may assert invariants
12. **No skipped input validation** — method parameters that can be invalid (empty strings, out-of-range numbers, wrong types) must be validated; never assume the caller did it
13. **No inline type definitions in implementation files** — never define an `interface`, `type alias`, or `enum` inside a service, controller, repository, or handler file; define them in a dedicated type file and import
14. **No technical/generic names** — never name a file, class, function, or variable with generic technical words (`data`, `info`, `manager`, `handler`, `utils`, `helpers`, `common`, `process`, `do`) without a business qualifier that explains *what* it is
