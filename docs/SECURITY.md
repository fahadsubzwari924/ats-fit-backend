# Security — ats-fit-backend

## Input

- Validate all untrusted input at the boundary with explicit schemas
- Enforce size limits on payloads and uploads

## AuthN / AuthZ

- Authenticate callers before authorization checks
- Default deny; document each public route's required role/scope
- Re-verify authorization on every request—do not trust client-side flags alone

## Secrets

- Load from environment or a secret manager—never commit secrets
- Rotate credentials with a documented process

## Web (if applicable)

- Set secure cookie flags; prefer HttpOnly for session tokens
- Encode output contextually to mitigate XSS
- Use CSRF protections for cookie-based sessions on mutating routes

## Injection

- Parameterize SQL; avoid string-concatenated queries
- Sanitize or allow-list any dynamic file paths

## Dependencies

- Pin versions; review changelogs for security fixes
- Run `npm audit` / ecosystem equivalent in CI where practical

## Data

- Minimize PII collection; define retention and deletion expectations
