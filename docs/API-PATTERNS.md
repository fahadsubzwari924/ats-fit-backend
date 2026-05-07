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

## Async Long-Running Operation Pattern (Queue + SSE)

Use when an operation takes >5 seconds and the user should not be blocked.

### Components

1. **HTTP POST** — validates input, creates DB run + job rows in a transaction, enqueues Bull jobs, returns 202 with `{ id, totalItems }` in <500ms
2. **Bull worker** — processes each job, emits stage events via the pub-sub gateway, persists results to DB
3. **RxJS Subject gateway** (`*EventsGateway`) — in-process pub-sub bridge, filtered by run ID
4. **SSE endpoint** — sends initial `snapshot`, forwards all gateway events, sends `heartbeat` every 20s, closes after terminal event
5. **Polling fallback** — `GET /:id/status` returns the same snapshot shape for proxy/CDN environments that strip SSE

### Event shape conventions

- First event after connect: `snapshot` with full current state (enables reconnect without replay)
- Granular progress events: `*_started`, `*_progress`, `*_completed`, `*_failed`
- Terminal event: `*_completed` — client closes connection on receipt
- Heartbeat: 20s interval, event name `heartbeat`, data `{ ts: number }`

### Auth for SSE

`EventSource` cannot send `Authorization` headers. Pass the JWT as `?access_token=<token>` query param. The guard must be configured to read from query params for SSE routes.

### Anti-patterns to avoid

- Holding the HTTP connection open for >30s (use 202 + SSE instead)
- Storing event history in memory (use DB snapshot for reconnect)
- Using WebSocket when one-way streaming is sufficient
- Polling faster than 2s (unnecessary load; use SSE)

### Example: v2 Batch Tailoring

- Enqueue: `POST /resume-tailoring/batch/v2/generate` → `{ batchId, totalJobs }`
- Stream: `GET /resume-tailoring/batch/v2/:batchId/events`
- Fallback: `GET /resume-tailoring/batch/v2/:batchId/status`
- Key files: `batch-tailoring-v2.service.ts`, `batch-tailoring-v2.processor.ts`, `batch-tailoring-v2.events.gateway.ts`, `batch-tailoring-v2.controller.ts`
