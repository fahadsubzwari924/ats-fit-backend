---
doc_type: business
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Business context

**Audience:** Product, engineering, AI assistants.  
**Companion:** Technical behavior lives in numbered domain specs and [functional-requirements.md](./functional-requirements.md).

## Value proposition

ATS Fit helps **job seekers** spend less time per application while improving outcomes: align a resume to a specific role, understand keyword/ATS-style fit, optionally generate a cover letter, and **keep every application** in one pipeline instead of spreadsheets.

## Personas (concise)

| Persona | Goal | Pain we address |
|---------|------|-----------------|
| **Active applicant** | Apply to many roles quickly | Rewriting resume per JD; losing track of where they applied |
| **Quality-focused seeker** | Maximize interview conversion | Unsure how resume matches JD; wants structured feedback |
| **Returning user** | Maintain momentum across weeks | Single profile + history of generations and applications |

## Business goals

1. **Reduce time-to-apply** after the user has a base resume and job details.
2. **Increase perceived resume–job fit** via tailoring and scoring signals.
3. **Increase retention** via centralized application tracking and saved artifacts (generations, scores).
4. **Monetize sustainably** via plans, quotas, and subscription checkout—without surprising users on limits.

## Success metrics (examples—targets live with product)

Product should own numeric targets; engineering uses these as **design constraints** for observability and UX APIs.

| Metric | Why it matters |
|--------|----------------|
| **Tailored PDF completion rate** | Core value delivery |
| **Time from “start generate” to PDF received** | Latency / perceived quality |
| **ATS score usage vs generation usage** | Feature mix and funnel |
| **Applications created / active user / month** | Tracking feature adoption |
| **Checkout → active subscription conversion** | Monetization health |
| **Webhook processing success rate** | Billing integrity |

## Journey priority (for roadmap and testing focus)

| Priority | Journey | REQ anchor |
|----------|---------|------------|
| **P0** | Sign in, upload PDF, complete onboarding enrichment | REQ-002, REQ-003 |
| **P0** | Generate tailored resume for one job (PDF + persisted record) | REQ-004 |
| **P0** | ATS score for JD + resume | REQ-006 |
| **P1** | Job application CRUD + list + stats | REQ-007 |
| **P1** | Subscription checkout + webhook → active plan | REQ-008 |
| **P2** | Cover letter, batch generation, diff/history polish | REQ-005 |
| **P2** | Usage dashboards / rate-limit clarity | REQ-009 |

## Out of scope (product)

- Employer-side ATS, job crawling at scale, or applying on behalf of the user on external sites (unless explicitly added later).
- Legal/tax advice; salary data is user-entered tracking only.

## Related documents

- [00-product-overview.md](./00-product-overview.md) — Short backend-aligned summary
- [functional-requirements.md](./functional-requirements.md) — REQ-IDs
- [non-functional-requirements.md](./non-functional-requirements.md) — NFR-IDs
