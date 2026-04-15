---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-14
---

# Rate limits and usage

## Business intent

Protect **cost and reliability** of AI-heavy features while keeping the product **fair and understandable**: users see remaining quota and receive clear errors when limits are hit.

## Traceability

| ID | Kind |
|----|------|
| REQ-008 | Functional |
| NFR-PERF-03 | Non-functional |

## Acceptance criteria

- [ ] **AC-RAT-01:** Endpoints decorated with `@RateLimitFeature` reject over-quota requests with **403** and structured usage metadata in the error payload.
- [ ] **AC-RAT-02:** Public usage endpoint returns consistent usage stats for the resolved request context.
- [ ] **AC-RAT-03:** Authenticated usage endpoint includes `userId` and matches authenticated user context.
- [ ] **AC-RAT-04:** `GET /users/feature-usage` returns per-feature monthly-style stats aligned with product expectations (see controller schema).
- [ ] **AC-RAT-05:** Limits are configurable per **plan** and **user type** via `RateLimitService` / data—not hardcoded in specs.

## Feature types (`FeatureType` enum)

Used for quotas and guard metadata:

| Value | Typical use |
|-------|-------------|
| `resume_generation` | Single tailored PDF generation |
| `job_application_tracking` | Reserved for application tracking limits (if enforced) |
| `cover_letter` | Cover letter generation |
| `resume_batch_generation` | Batch tailor endpoint |

**Authoritative enum:** `database/entities/usage-tracking.entity.ts`.

## Global guard

- **`RateLimitGuard`** runs on all routes. It only **enforces** when the handler has **`@RateLimitFeature(<FeatureType>)`**.
- On exceed: **`403 Forbidden`** with structured details (`currentUsage`, `limit`, `remaining`, `resetDate`, `feature`, `userType`, `plan`)—see `ForbiddenException` usage in guard.

## HTTP usage endpoints

- **`GET /rate-limits/usage`** — **Public**; resolves request context and returns usage stats + `userType` / `plan`.
- **`GET /rate-limits/usage/authenticated`** — JWT required; includes `userId` in response.

## User feature usage (dashboard-style)

- **`GET /users/feature-usage`** — Authenticated; returns feature usage with `allowed`, `used`, `remaining`, `usagePercentage`, `resetDate` (see controller Swagger schema).

## Generation history access

History visibility is a **product-level rule** enforced in the resume tailoring service, separate from per-feature monthly quotas:

| Plan | History access |
|------|---------------|
| **Freemium** | Last **30 days** only (`FREEMIUM_HISTORY_LOOKBACK_DAYS = 30` in `shared/constants/plan-limits.constants.ts`) |
| **Pro** | Full history (no date filter) |

## Configuration source

Monthly feature limits per **plan** and **user type** live in DB/config services (`RateLimitService`). **Do not** hardcode those limits in this spec; **see** seed data / admin tooling / runbook.

## Related specs

- Identity context: [02-auth-and-identity.md](./02-auth-and-identity.md)
- Endpoints using limits: [03](./03-resume-tailoring.md), [06](./06-job-applications.md), [07](./07-subscriptions-billing.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
