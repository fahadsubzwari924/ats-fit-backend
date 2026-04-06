---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Authentication and identity

## Business intent

Let users **create an account and sign in** reliably (email/password and Google where enabled), then carry a **secure session** so all personal data and generations are scoped to the right user.

## Traceability

| ID | Kind |
|----|------|
| REQ-001 | Functional |
| NFR-SEC-01, NFR-SEC-05 | Non-functional |

## Acceptance criteria

- [ ] **AC-AUTH-01:** User can sign up and sign in via documented public endpoints; successful sign-in yields a JWT usable on protected routes.
- [ ] **AC-AUTH-02:** Google login accepts a client token and returns the same style session contract as email sign-in (see implementation).
- [ ] **AC-AUTH-03:** Protected routes reject missing/invalid JWT with documented error behavior except `@Public()` handlers.
- [ ] **AC-AUTH-04:** JWT validation confirms user still exists and is **active** per `jwt.strategy` behavior.

## Email / password

- **`POST /auth/signup`** — Create user (public).
- **`POST /auth/signin`** — Issue session JWT (public).

## Google

- **`POST /auth/google/login`** — Body: `token` (Google credential). Verifies token with Google, then signs up or signs in (public).
- **`POST /auth/google/webhook`** — Present in code as a stub/log endpoint; **intended** use (if any) is **see runbook**—do not rely on this spec for production webhooks without verifying implementation.

## JWT usage

- Clients send **`Authorization: Bearer <jwt>`** for protected routes.
- **Passport JWT strategy** validates signature and expiry, loads user from DB (`is_active: true`), uses a **short-lived query cache** (see `jwt.strategy.ts` in code).

## Public routes

- Handler or controller method annotated with **`@Public()`** bypasses `JwtAuthGuard`.
- Some public routes still run **rate limits** via `@RateLimitFeature` (e.g. resume generate, ATS score).

## User context (`request.userContext`)

Populated by **`UserContextMiddleware`** for most paths. Typical fields (see `UserContext` type in code):

- `userId`
- `userType`, `plan`, `isPremium` (as resolved by user service)
- `ipAddress`, `userAgent`

Skip list for middleware: **see** `MIDDLEWARE_CONFIG.SKIP_USER_CONTEXT_PATHS`.

## Related specs

- Limits tied to context: [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
