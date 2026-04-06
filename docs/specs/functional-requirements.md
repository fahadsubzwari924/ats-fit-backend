---
doc_type: requirements
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Functional requirements (traceability)

**Purpose:** Stable **REQ-** identifiers for commits, tests, and AI prompts. One row = one testable outcome at product level; implementation details stay in domain specs and code.

**Convention:** Changing behavior that invalidates a REQ requires updating this row and the linked spec’s acceptance criteria.

| ID | Priority | Requirement | Primary spec | Code entrypoints (indicative) |
|----|----------|-------------|--------------|-------------------------------|
| **REQ-001** | P0 | User can register and sign in; session uses JWT; Google sign-in works where enabled. | [02-auth-and-identity.md](./02-auth-and-identity.md) | `modules/auth/` |
| **REQ-002** | P0 | User can upload **one** canonical PDF resume; file stored durably; async extraction queued for registered flow. | [04-profile-enrichment.md](./04-profile-enrichment.md) | `modules/user/`, `resume-tailoring` queues |
| **REQ-003** | P0 | User can answer profile questions; completeness updates; enrichment runs when appropriate; client can poll status. | [04-profile-enrichment.md](./04-profile-enrichment.md) | `profile-questions.controller`, enrichment services |
| **REQ-004** | P0 | User can generate a **tailored resume PDF** for a job (with limits); response exposes generation id and key metrics (headers). | [03-resume-tailoring.md](./03-resume-tailoring.md) | `resume-tailoring.controller`, orchestrator |
| **REQ-005** | P2 | User can generate cover letter (standalone or from generation); **batch** tailor multiple jobs within plan limits. | [03-resume-tailoring.md](./03-resume-tailoring.md) | `cover-letter`, `batch-generate` |
| **REQ-006** | P1 | User can create, list, filter, update, delete **job applications**; see aggregate stats; link optional generation artifacts. | [06-job-applications.md](./06-job-applications.md) | `job-application/` |
| **REQ-007** | P1 | User can list plans, start checkout, and—via **intended** webhook flow—activate subscription; payment history auditable. | [07-subscriptions-billing.md](./07-subscriptions-billing.md) | `subscription/` |
| **REQ-008** | P1 | System enforces per-feature usage / rate limits by plan; user can query usage for UI. | [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md) | `rate-limit/`, `FeatureType` |
| **REQ-009** | P0 | API errors are consistent; health checks exist; sensitive config is not embedded in specs. | [09-api-conventions.md](./09-api-conventions.md), [01-architecture.md](./01-architecture.md) | `health/`, exception layer |

## User stories (cross-cutting)

Stories are intentionally **epic-level**; acceptance checks are in each domain spec.

- **US-1:** As a job seeker, I want to **store one resume** and enrich my profile so tailoring uses my real experience.
- **US-2:** As a job seeker, I want to **generate a tailored PDF** for a specific posting so I can apply faster with a relevant resume.
- **US-3:** As a job seeker, I want to **track applications** in one place so I do not lose follow-ups.
- **US-4:** As a job seeker, I want to **upgrade via subscription** so I get higher limits and premium features.

## Related documents

- [business-context.md](./business-context.md) — Personas, priorities, metrics
- [non-functional-requirements.md](./non-functional-requirements.md) — NFR-IDs
