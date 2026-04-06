# Backend specifications (`docs/specs`)

**Audience:** Human engineers, product, and AI coding assistants.  
**Scope:** `ats-fit-backend` only.  
**Secrets / env:** Never duplicated here. Use environment configuration and your deployment runbook.

## Document layers

| Layer | Purpose |
|-------|---------|
| **Business** | Why we build it—personas, priorities, metrics ([business-context.md](./business-context.md)) |
| **Requirements** | Traceable **REQ-** / **US-** / **NFR-** IDs ([functional-requirements.md](./functional-requirements.md), [non-functional-requirements.md](./non-functional-requirements.md)) |
| **Domain specs** | What the API and modules do + **AC-** acceptance criteria (numbered domain files below) |

**Suggested reading order:** [business-context.md](./business-context.md) → [00-product-overview.md](./00-product-overview.md) → [functional-requirements.md](./functional-requirements.md) → domain spec for the area you are changing.

## How to use these docs

1. Start with **business context** and **product overview** for intent and journey priorities.
2. Map work to a **REQ-** row in [functional-requirements.md](./functional-requirements.md).
3. Open the **domain spec** for APIs, behavior, and **acceptance criteria (AC-)**.
4. Check **NFRs** when touching security, webhooks, reliability, or data handling.
5. **API conventions** describe errors, headers, and cross-cutting HTTP behavior.

## Index

| Doc | Topic |
|-----|--------|
| [business-context.md](./business-context.md) | Personas, goals, success metrics, journey priorities |
| [functional-requirements.md](./functional-requirements.md) | REQ-IDs, user stories, links to specs and code |
| [non-functional-requirements.md](./non-functional-requirements.md) | NFR-IDs (security, reliability, performance, data, observability) |
| [00-product-overview.md](./00-product-overview.md) | Short vision, actors, journeys, non-goals |
| [01-architecture.md](./01-architecture.md) | Nest layout, guards, middleware, Bull queues |
| [02-auth-and-identity.md](./02-auth-and-identity.md) | JWT, `@Public()`, user context |
| [03-resume-tailoring.md](./03-resume-tailoring.md) | Generate, history, PDF, diff, cover letter, batch |
| [04-profile-enrichment.md](./04-profile-enrichment.md) | Upload, extraction queue, Q&A, enrichment |
| [06-job-applications.md](./06-job-applications.md) | CRUD, filters, stats, enums |
| [07-subscriptions-billing.md](./07-subscriptions-billing.md) | Plans, checkout, webhooks (**intended** behavior) |
| [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md) | Feature types, limits, usage endpoints |
| [09-api-conventions.md](./09-api-conventions.md) | Errors, field selection, response patterns |

## Document metadata convention

YAML frontmatter on each spec (where present):

- **`status`:** `draft` | `review` | `approved`
- **`owner`:** team or role name
- **`last_reviewed`:** ISO date (`YYYY-MM-DD`)

Update **`last_reviewed`** when behavior or acceptance criteria change.

## Glossary

- **User context:** Request-scoped identity and plan metadata resolved by middleware/services.
- **Resume generation id:** Identifier for one tailored resume generation run (PDF + metadata).
- **Processing id:** Identifier for async **extracted** resume / processing record after upload.

## Maintenance

When behavior changes: update the **REQ** row (if scope shifts), the **domain spec**, relevant **AC-** checkboxes, and **NFR** rows if security/ops assumptions change. Keep **one authoritative fact** per topic—cross-link instead of duplicating.
