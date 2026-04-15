# API patterns — ats-fit-backend

## REST shape

| Concern | Rule |
|---------|------|
| URLs | Plural nouns; stable versioning (`/v1/...`) |
| Methods | `GET` safe/idempotent; `POST` create; `PUT`/`PATCH` update; `DELETE` remove |
| Status | Use correct 2xx/4xx/5xx; avoid 200 with error payloads |

## Request validation (required — non-negotiable)

- Validate **every** incoming field (body, params, query string) at the route/controller boundary with a schema library **before** the service is called
- Reject unknown/extra fields when schema is strict — `whitelist` / `stripUnknown` where available
- Normalize types at the boundary; services receive typed, validated domain models — not raw strings/any
- Return `400` with a structured error body listing which fields failed and why — never return a generic "Invalid request"
- Never repeat validation inside the service; trust that the controller enforced the boundary contract

## Layer responsibilities

| Layer | What it handles | What it must NOT do |
|-------|----------------|---------------------|
| Router | Mount routes, attach middleware | Logic, DB calls |
| Controller | Parse → validate → call service → respond | Business rules, DB queries |
| Service | Business logic, domain decisions, orchestration | `req`/`res`, raw DB queries |
| Repository | Queries and mutations only | Business logic |

**Rule:** business logic that crosses this boundary is a defect, not a shortcut.

## Pagination

| Style | When |
|-------|------|
| Cursor-based | Large, stable feeds |
| Offset/limit | Admin tools with small datasets |

Include `next_cursor` or `page`/`page_size` consistently.

## Errors

| Field | Purpose |
|-------|---------|
| `code` | Machine-stable identifier |
| `message` | Human readable, safe for clients |
| `details` | Optional structured context (no secrets) |

## Idempotency

- Use idempotency keys for `POST` that create billable or side-effectful resources

## Versioning

- Breaking changes: new major version path or explicit deprecation window documented
