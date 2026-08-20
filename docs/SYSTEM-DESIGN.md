# Tairly — System Design

> A SaaS platform that helps job seekers **tailor resumes to job descriptions**, generate cover letters, score ATS fit, track applications, and manage subscriptions.
> This document is the single-page system design reference. The companion diagram is [`system-design-diagram.svg`](./system-design-diagram.svg).

---

## 1. Overview

| Aspect | Value |
|---|---|
| **Product** | Tairly (formerly ATS Fit) |
| **Surfaces** | Marketing site, SaaS web app (SPA), REST API |
| **Core value** | AI resume tailoring with anti-hallucination guardrails, ATS match scoring, batch generation, billing |
| **Hosting model** | Railway (compute + managed data plugins) behind Cloudflare (DNS/CDN/TLS) |
| **Scope of this doc** | `ats-fit-backend` (API) and `ats-fit-frontend` (SPA) |

---

## 2. Architecture at a glance

The system is a **modular monolith** (NestJS) fronted by a **single-page app** (Angular), with **asynchronous work pushed off the request path** onto Bull/Redis queues, a **single source of truth** in PostgreSQL, and **object storage** (S3) for binary artifacts. AI is delegated to external LLM providers; payments, email, and identity are also externalized.

```
Browser ─▶ Cloudflare ─▶ [ Marketing (Pages) | SPA (Railway/nginx) ] ─▶ API (Railway/NestJS)
                                                                          │
                            ┌─────────────────┬──────────────┬───────────┴──────────┐
                            ▼                 ▼              ▼                        ▼
                       PostgreSQL          Redis/Bull      S3 buckets        External APIs
                      (source of truth)  (async + cache)  (PDF/resumes)   (LLM, mail, billing)
```

See the SVG for the full, layered, component-level diagram.

---

## 3. Layers and responsibilities

### 3.1 Edge & delivery
- **Cloudflare** — authoritative DNS, edge CDN, TLS termination, WAF. CNAME-at-apex enables clean failover and Pages hosting.
- **Marketing site** (`tairly.com`) — static build (Tailwind), served from **Cloudflare Pages**. Decoupled from the app for best TTFB/SEO.
- **SaaS app** (`app.tairly.com`) — **Angular 19 + Angular Material** SPA, built to static assets and served by **nginx on Railway**. Talks to the API over HTTPS; consumes streamed PDFs and **Server-Sent Events** for batch progress.

### 3.2 API platform (`api.tairly.com`, Railway · NestJS · TypeScript)
- REST under **`/api/v1`** (URI versioning), **Swagger/OpenAPI** in-app.
- **Cross-cutting (global):** Request-Id middleware, CORS allow-list, **`JwtAuthGuard`** (default-deny; `@Public()` opt-out), **`RateLimitGuard`** (engages on `@RateLimitFeature(...)` metadata), **`UserContextMiddleware`** (builds `request.userContext`), a uniform **Response interceptor** + **global exception filter**, and **Joi-validated** env config.

### 3.3 Application modules (feature-bounded)
| Module | Responsibility |
|---|---|
| **Auth** | Email/password + Google OAuth sign-in, JWT issuance, password reset |
| **User** | Resume upload, processed resumes, feature usage, onboarding state |
| **Resume Tailoring** | JD analysis, AI optimization, PDF build, history, before/after diff, cover letter |
| **Batch Tailoring v2** | Async batch (HTTP 202) with SSE progress, parallel jobs (concurrency 3), reconnect-safe |
| **Job Application** | Application CRUD, status pipeline, interviews, stats |
| **Subscription** | Plans, checkout, payment webhooks, entitlement state |
| **Rate Limit & Usage** | Plan-based quotas, usage tracking, HTTP usage reporting |
| **Job Relevance** | Pre-generation fit gate (Claude Haiku) with kill-switch |
| **Beta Access** | Invites, redemption, lifecycle emails |
| **Contact** | Contact-form intake + notification |
| **ATS Match** | ATS keyword match scoring history |
| **Health** | Liveness `GET /api/v1/health` (Railway healthcheck) |

### 3.4 Asynchronous processing (Bull on Redis)
Long-running and side-effect work runs off the request path with **3 retries / exponential backoff**.

| Queue | Purpose |
|---|---|
| `resume_processing` | Post-upload PDF extraction |
| `profile_enrichment` | Build enriched profile after Q&A |
| `changes_diff` | Persist before/after diff for a generation |
| `batch_tailoring_v2` | Parallel batch tailoring jobs feeding the SSE stream |
| beta lifecycle | Invite / redeemed / expiry-sweep emails |

### 3.5 Data stores
- **PostgreSQL** (Railway plugin, **TypeORM**) — system of record. Table groups: *identity* (`users`, `password_reset_tokens`, `user_subscriptions`), *resume* (`candidate_resumes`, `extracted_resume_content`, `enriched_resume_profile`, `resume_templates`, `resume_generations`, `resume_generation_result`, `tailoring_session`, `resume_replacement_audit`), *batch* (`batch_tailoring_run`, `batch_tailoring_job`), *billing* (`subscription_plan`, `payment_history`), *ops* (`usage_tracking`, `rate_limit_config`, `queue_message`, `beta_invite`, `ats_match_history`, `job_application`, `job_application_interview`).
- **Redis** (Railway plugin) — Bull queue backend + batch/run state + caching (templates, resume service).
- **S3** — object storage for **candidate resumes, generated PDFs, resume templates, email templates** (presigned access).

### 3.6 External integrations
| Provider | Use |
|---|---|
| **OpenAI** | Primary tailoring & resume-extraction LLM (`OPENAI_MODEL`) |
| **Anthropic Claude (Haiku 4.5)** | Job-relevance pre-generation gate |
| **AWS SES + Brevo** | Transactional & lifecycle email (templated) |
| **Lemon Squeezy** | Checkout, payments, signed webhooks |
| **Google OAuth** | Federated sign-in |
| **PDF engine** | Puppeteer / node-latex (in-process render) |

---

## 4. Key request flows

1. **Onboard** — sign up → upload PDF → `resume_processing` extraction → profile Q&A → `profile_enrichment` → onboarding complete.
2. **Tailor (single)** — `POST /resume-tailoring/generate` → (optional **relevance gate** in parallel; low-fit returns a JSON warning instead of a PDF) → JD analysis + optimization (with tech-substitution guardrails) → PDF stream + metric headers → `changes_diff` persisted async.
3. **Tailor (batch v2)** — `POST .../batch/v2/generate` returns **202** in <500 ms → jobs enqueued → worker processes 3-in-parallel → **SSE** (`job_started`/`job_progress`/`job_completed`/`batch_completed`) → state survives reconnects via `batch_tailoring_*` tables.
4. **Monetize** — list plans → checkout (Lemon Squeezy) → **signed webhook** `POST /subscriptions/payment-confirmation` → idempotent `payment_history` write → entitlement update.

---

## 5. Cross-cutting concerns (best-practice posture)

| Concern | Approach |
|---|---|
| **Security** | Default-deny JWT auth, signature-verified webhooks, boundary validation (class-validator/Joi), parameterized ORM queries, secrets via env/secret manager, least-privilege S3 |
| **Reliability** | Queue retries + exponential backoff, graceful shutdown hooks, Railway healthcheck + `restart on failure`, pre-deploy migrations, batch state durability |
| **Scalability** | Stateless API (scale horizontally), async heavy work, Redis-backed queues, S3 offload, CDN at the edge |
| **Observability** | Request-Id correlation, structured exception filter, drift logging (`hallucinated_tech`/`hallucinated_skills`), health endpoint |
| **Cost/SEO** | Static marketing at the edge (Cloudflare Pages), app + API co-located in one Railway project on private networking |
| **AI quality** | Deterministic match scorer, prompt-fence + post-LLM scrubber + skills lock against hallucinated tech, relevance gate kill-switch |

---

## 6. Key design decisions & trade-offs

| Decision | Why | Trade-off |
|---|---|---|
| **Modular monolith** over microservices | One team, fast iteration, shared DB transactions | Must enforce module boundaries by discipline |
| **Async + SSE for batch v2** | Sub-500 ms response, live progress, resilience | More moving parts (queue + state tables) vs simple sync v1 (kept for legacy) |
| **Two AI providers** | Cheap/fast Haiku for gating, OpenAI for quality tailoring | Two vendor integrations to operate |
| **Cloudflare Pages + Railway split** | Best TTFB for marketing, co-located app/API/data | Two deploy targets, two DNS surfaces |
| **Deterministic guardrails around LLM** | Trust: no invented metrics or swapped tech | Extra post-processing per generation |

---

## 7. Non-goals
- Not an employer ATS or job board.
- Does not host the marketing SPA inside the API.
- Single canonical PDF per user upload (not arbitrary formats).
