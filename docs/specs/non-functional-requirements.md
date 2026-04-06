---
doc_type: nfr
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# Non-functional requirements

**Audience:** Engineering, security, SRE, AI assistants.  
**Rule:** Numeric SLOs, regions, and keys live in **runbook / env**—not in this file.

## Security & privacy

| ID | Requirement |
|----|-------------|
| **NFR-SEC-01** | Authenticated access to user data must require valid JWT except explicitly `@Public()` routes documented in specs. |
| **NFR-SEC-02** | Payment webhooks must verify provider signature in production when secret is configured (**see env / runbook**). |
| **NFR-SEC-03** | Secrets (API keys, webhook secrets, DB URLs) must never be committed; use configuration management per runbook. |
| **NFR-SEC-04** | User documents (resumes, PDFs) reside in object storage with access policies aligned to product (**see runbook**). |
| **NFR-SEC-05** | Inactive or disabled users must not receive authenticated sessions (JWT validation aligns with `is_active`—**see** `jwt.strategy`). |

## Reliability & availability

| ID | Requirement |
|----|-------------|
| **NFR-REL-01** | Service exposes **health** endpoints for liveness; orchestration uses them per deployment guide. |
| **NFR-REL-02** | Async jobs (Bull) use retries and backoff; failed jobs must be observable (**see runbook** logging/metrics). |
| **NFR-REL-03** | Payment notification handling must be **idempotent** at the payment-record level (duplicate gateway events do not double-charge business logic). |

## Performance & scale

| ID | Requirement |
|----|-------------|
| **NFR-PERF-01** | Tailored generation and enrichment calls depend on external AI latency; product-facing timeouts and UX copy are owned by frontend + API gateway policies (**see runbook**). |
| **NFR-PERF-02** | Batch generation is **sequential** by design; document max batch size and timeouts if enforced (**see code / runbook**). |
| **NFR-PERF-03** | Rate limits protect upstream AI and cost; limits are configurable per plan (**see** `RateLimitService` / data seeds). |

## Data & compliance

| ID | Requirement |
|----|-------------|
| **NFR-DATA-01** | Retention and deletion for resumes, generations, and applications follow product/legal policy (**see runbook**); implementation must be discoverable in code or ops docs. |
| **NFR-DATA-02** | Audit trail for payments: payment history records gateway payload references as designed (**see** `PaymentHistory` entity). |

## Observability

| ID | Requirement |
|----|-------------|
| **NFR-OBS-01** | Critical flows (generation, webhook, queue failures) must emit logs suitable for alerting (**see runbook** dashboards). |

## Related documents

- [01-architecture.md](./01-architecture.md) — Components that implement NFRs
- [07-subscriptions-billing.md](./07-subscriptions-billing.md) — Webhook intent
- [functional-requirements.md](./functional-requirements.md) — REQ traceability
