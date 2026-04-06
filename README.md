# ATS Fit Backend

NestJS backend for ATS Fit, a SaaS platform that helps job seekers tailor resumes to job descriptions, score ATS fit, generate cover letters, track applications, and manage subscriptions.

## What this service provides

- Authentication (email/password + Google token login)
- Resume upload, extraction, and profile enrichment flow
- Tailored resume PDF generation (single + batch)
- ATS matching score and history
- Job application tracking (CRUD + stats)
- Subscription checkout and payment webhook handling
- Feature usage tracking and rate limits

## Tech stack

- NestJS + TypeScript
- PostgreSQL (TypeORM)
- Redis + Bull queues
- AWS services (S3/SES where configured)
- OpenAI and other external providers (configured via env)

## Documentation

- Product and feature specs: `docs/specs/README.md`
- Business context: `docs/specs/business-context.md`
- Functional requirements: `docs/specs/functional-requirements.md`
- Non-functional requirements: `docs/specs/non-functional-requirements.md`

## Quick start (local)

### Prerequisites

- Node.js 18+
- npm
- Docker Desktop
- Make

### 1) Install dependencies

```bash
npm install
```

### 2) Start local infrastructure (PostgreSQL + Redis + tools)

```bash
make dev
```

### 3) Run database migrations

```bash
npm run migration:run
```

### 4) Optional seed data

```bash
npm run seed:resume-templates
npm run seed:rate-limits
npm run seed:subscription-plans
```

### 5) Start the API

```bash
npm run start:dev
```

### 6) Verify health

```bash
curl http://localhost:3000/health
```

## Useful commands

```bash
# App
npm run start:dev
npm run build
npm run start:prod

# Tests
npm run test
npm run test:e2e
npm run test:cov

# Lint/format
npm run lint
npm run format

# Infra helpers
make status
make logs
make stop
make clean
```

## Environment configuration

- Runtime env files are loaded from:
  - `src/config/.env.dev` (development)
  - `src/config/.env.prod` (production)
- Keep secrets out of git. Use local env management and deployment runbooks.

Minimum categories you must configure:

- Database (`DATABASE_*`)
- Redis (`REDIS_*`)
- JWT (`JWT_SECRET`)
- Storage/Email provider credentials
- AI provider credentials
- Payment webhook and gateway settings

## API notes

- Auth: Bearer JWT for protected endpoints
- Health endpoint: `GET /health`
- Swagger/OpenAPI is enabled in-app; see runtime config for docs path

## Repository scope

This repository is backend-only. Frontend code and dashboards live in separate repositories/workspaces.

## License

UNLICENSED
