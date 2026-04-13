# Error handling — ats-fit-backend

## Philosophy

- Fail loudly at boundaries; convert to stable user-facing errors at the edge
- Preserve cause chain for operators; strip internals for clients

## Custom errors

| Field | Use |
|-------|-----|
| `name` / `code` | Stable identifier for logs and metrics |
| `message` | Operator-safe detail |
| `cause` | Wrapped lower-level error |

## Boundaries

| Layer | Behavior |
|-------|----------|
| HTTP/API | Map domain failures to status + error body per `docs/API-PATTERNS.md` |
| UI | Show actionable copy; log correlation id |
| Jobs/queues | Retry only transient failures; dead-letter poison messages |

## Logging

- Structured logs: include request/job id, feature, outcome
- Never log secrets, tokens, full payloads with PII

## Assertions vs errors

- Use assertions for programmer mistakes in dev/test
- Use typed errors for expected business failures (e.g. not found, conflict)
