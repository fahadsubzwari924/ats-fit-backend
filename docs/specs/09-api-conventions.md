---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# API conventions

## Business intent

Give clients and partners **predictable** integration: consistent auth, errors, optional field projection, and operational endpoints—so frontend and AI tools can rely on stable contracts.

## Traceability

| ID | Kind |
|----|------|
| REQ-010 | Functional |
| NFR-OBS-01 | Non-functional (health / operability) |

## Acceptance criteria

- [ ] **AC-API-01:** Protected routes require `Authorization: Bearer` except `@Public()` handlers.
- [ ] **AC-API-02:** Error responses use the application’s **exception + ERROR_CODES** pattern (see code); status codes align with exception types.
- [ ] **AC-API-03:** Job application list/detail support optional **`fields`** query without exposing unauthorized data.
- [ ] **AC-API-04:** PDF responses set **Content-Type** and **Content-Disposition** appropriately; generation/download documented in resume spec.
- [ ] **AC-API-05:** **`GET /health`** returns liveness fields suitable for orchestrators.

## Base URL and docs

- API base path follows Nest global prefix if configured in `main.ts` (**check** bootstrap).
- Swagger UI path: typically under `/docs` (middleware skip list references `/docs`). **See** runtime config.

## Authentication

- **Bearer JWT** for protected routes.
- **`@Public()`** skips JWT requirement; some public routes still require **rate limit** context from middleware.

## Errors

- Application uses **custom HTTP exceptions** with **`ERROR_CODES`** (see `shared/constants/error-codes` and `shared/exceptions`).
- Clients should use **HTTP status** + **body** (code/message/extra payload) consistently; exact JSON shape: **see** exception filter / interceptor in code.

## Sparse field selection

- **`@SelectFields()`** decorator (job applications list/detail/stats): query param **`fields`** comma-separated list restricts columns returned. Allowed field names must stay in sync with DTO/service allowlists in code.

## Binary responses

- Resume **generate** and **download** return **PDF** with custom **headers** for metadata (generation id, scores, etc.)—see resume-tailoring controller.

## User context

- Most requests expose **`userContext`** on the request object after middleware (see [02-auth-and-identity.md](./02-auth-and-identity.md)).

## Health

- **`GET /health`** — Liveness JSON (`status`, `timestamp`, `uptime`, `environment`).
- **`GET /health/circuit-breakers`** — Operational note for circuit breakers (e.g. storage resilience).

## Idempotency and retries

- Payment webhook idempotency: **see** [07-subscriptions-billing.md](./07-subscriptions-billing.md) and `PaymentHistoryService`.
- Queue jobs: Bull **attempts** and **backoff** configured in `app.module` / `QueueModule`—**see code**.

## Versioning

- No URL version prefix is mandated in this spec; if introduced, document in this file and README.

## Related specs

- Architecture: [01-architecture.md](./01-architecture.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
- NFRs: [non-functional-requirements.md](./non-functional-requirements.md)
