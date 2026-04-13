# Testing strategy — ats-fit-backend

## Goals

- Prove behavior the team relies on—not implementation trivia
- Fail fast in CI on regressions touching covered behavior

## Layout

| Layer | Where | Notes |
|-------|-------|-------|
| Unit | Colocated or `tests/unit` | Pure logic, fast |
| Integration | `tests/integration` | DB, HTTP, queues with test doubles where needed |
| E2E | `tests/e2e` | Few, high-value user paths |

## Coverage expectations

- New bug fixes include a regression test unless truly impossible—then document why
- Critical domain rules: aim for direct unit tests on invariants

## Do not test

- Third-party library internals
- Generated code without business rules
- Exact log message wording unless contractually required

## Mocking

- Mock I/O boundaries (HTTP, DB client, clock), not domain logic
- Prefer fakes over deep mocks when behavior matters

## Commands

- Default test entry: `npm run test`
