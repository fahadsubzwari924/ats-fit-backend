# Architecture — ats-fit-backend

## Purpose

Describe what the system does for users and the main runtime boundaries.

## Context diagram

- **Actors**: (users, admins, other services)
- **External systems**: (payments, email, identity)
- **This repo**: (apps, packages, workers)

## Logical structure

| Area | Responsibility | Key modules |
|------|------------------|-------------|
| UI / API edge | Transport, validation at boundary | _TBD_ |
| Application | Use cases, orchestration | _TBD_ |
| Domain | Entities, invariants, policies | _TBD_ |
| Infrastructure | DB, queues, object storage, 3rd-party SDKs | _TBD_ |

## Data flow

1. Request/event enters at: _TBD_
2. Authoritative state lives in: _TBD_
3. Async work is handled by: _TBD_

## Key decisions

| Decision | Why | Tradeoff |
|----------|-----|----------|
| _TBD_ | _TBD_ | _TBD_ |

## Non-goals

- _List explicit out-of-scope items to prevent accidental coupling_

## Evolution

- Next likely split: _TBD_
- Deprecations: _TBD_
