---
doc_type: product-overview
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Product overview (backend lens)

## Problem

Job seekers need to **tailor resumes** to job descriptions, optionally produce **cover letters**, and **track applications** in one place—without redoing the same manual work for every role.

## Primary actors

- **Job seeker:** Account holder with JWT sessions, uploads a base resume (PDF), completes profile enrichment, and uses quota-limited features by plan.

## Core journeys (what the backend enables)

| # | Journey | User story (summary) |
|---|---------|----------------------|
| 1 | **Onboard** | As a user, I want to upload my resume and complete profile Q&A so tailoring uses accurate context. |
| 2 | **Tailor** | As a user, I want a tailored PDF for a specific job so I can apply with a relevant resume. |
| 3 | **Apply & track** | As a user, I want one list of applications with status and notes so I do not lose track. |
| 4 | **Monetize** | As a user, I want to subscribe for higher limits so I can use premium workflows. |

**Backend steps (journey 1):** Sign up / sign in → upload PDF → async extraction → profile questions → enrichment → mark onboarding complete.  
**Backend steps (journey 2):** Submit job details (+ optional file or stored resume) → generate tailored PDF → optional cover letter → optional batch (plan-gated).  
**Backend steps (journey 3):** CRUD **job application** records with status pipeline, notes, dates, links to tailored generations.  
**Backend steps (journey 4):** Browse plans → checkout → webhook confirms payment → subscription and payment history updated (**intended** flow in [07-subscriptions-billing.md](./07-subscriptions-billing.md)).

## Non-goals (backend)

- Hosting the marketing site or SPA (frontend is a separate codebase).
- Acting as the employer ATS or job board.
- Storing arbitrary non-PDF resume formats as the canonical user upload (current rule: **single PDF** per user for stored upload—see [04-profile-enrichment.md](./04-profile-enrichment.md)).

## Related specs

- Business depth: [business-context.md](./business-context.md)
- REQ / US mapping: [functional-requirements.md](./functional-requirements.md)
- Technical shape: [01-architecture.md](./01-architecture.md)
- HTTP and errors: [09-api-conventions.md](./09-api-conventions.md)
- NFRs: [non-functional-requirements.md](./non-functional-requirements.md)
