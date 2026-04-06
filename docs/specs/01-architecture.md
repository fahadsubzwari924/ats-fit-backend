---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Architecture

## Business intent

Give the product a **maintainable, observable backend**: clear module boundaries, async work off the request path, and configuration that can differ per environment without leaking secrets into docs.

## Traceability

| ID | Kind |
|----|------|
| REQ-010 | Functional (platform / cross-cutting) |
| NFR-REL-01, NFR-REL-02, NFR-OBS-01 | Non-functional |

## Acceptance criteria

- [ ] **AC-ARC-01:** New contributors can locate a feature by module name using the module map below.
- [ ] **AC-ARC-02:** Long-running resume and enrichment work is modeled as **Bull queues** with named queues documented here.
- [ ] **AC-ARC-03:** Global guards (`JwtAuthGuard`, `RateLimitGuard`) and user-context middleware behavior are described and match `app.module` / middleware config in code.

## Stack (summary)

- **Runtime:** Node.js, **NestJS**
- **DB:** PostgreSQL via **TypeORM**
- **Queues:** **Bull** on **Redis** (job options: retries, backoff—see app bootstrap)
- **Storage:** Object storage for resumes/PDFs (provider and bucket: **see env / runbook**)
- **AI / external APIs:** Invoked from shared and domain services (keys and models: **see env / runbook**)
- **Email:** SES (or configured provider) for transactional mail (**see env / runbook**)
- **Payments:** Abstracted payment service; concrete gateway wired in configuration (**see env / runbook**)

## Module map (feature modules)

| Module | Responsibility |
|--------|----------------|
| `AuthModule` | Sign up, sign in, Google token login |
| `UserModule` | Resume upload, processed resumes, feature usage, onboarding flag |
| `ResumeTailoringModule` | Templates, generation, history, download, diff, cover letter, batch, profile questions |
| `AtsMatchModule` | ATS score, match history, available resumes |
| `JobApplicationModule` | Application CRUD, list filters, stats |
| `SubscriptionModule` | Plans, checkout, webhooks, payment/subscription reads |
| `RateLimitModule` | Usage checks and HTTP usage reporting |
| `QueueModule` | Bull queue registration (infrastructure); processors live in domain modules |
| `HealthModule` | Liveness-style checks |
| `DatabaseModule` | TypeORM connection |
| `SharedModule` | Cross-cutting services, pipes, decorators |

## Global HTTP concerns

- **`JwtAuthGuard`** (global): All routes require JWT unless marked **`@Public()`**.
- **`RateLimitGuard`** (global): Enforces limits when a handler sets **`@RateLimitFeature(FeatureType.*)`** metadata; otherwise passes through.
- **`UserContextMiddleware`**: Runs for most routes; builds **`request.userContext`** from request identity and user metadata. Paths skipped: configured skip list (e.g. health, docs—**see** `shared/constants/middleware-config` in code).

## Bull queues (infrastructure names)

Registered in `QueueModule` (domain code registers consumers):

| Queue name | Typical use |
|------------|-------------|
| `resume_processing` | Post-upload extraction / onboarding processing |
| `profile_enrichment` | Build enriched profile after Q&A |
| `changes_diff` | Persist before/after diff for a generation |

Exact processors and payloads: **see** `resume-tailoring` services and processors in the codebase.

## Configuration

- **Joi-validated** env via `ConfigModule` (schema under `src/config/`).
- **No secrets** in this repo’s specs—use runbook.

## Related specs

- Auth details: [02-auth-and-identity.md](./02-auth-and-identity.md)
- Domains: [03](./03-resume-tailoring.md)–[08](./08-rate-limits-and-usage.md)
- NFRs: [non-functional-requirements.md](./non-functional-requirements.md)
