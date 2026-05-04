# ats-fit-backend — Claude Code

## Identity

| Field | Value |
|-------|-------|
| Language | TypeScript |
| Framework | NestJS |
| Database | SQL (TypeORM) |

## Operating contract

Operating contract: see `.ai/CONTRACT.md` (loaded automatically via hooks).

## Read first

1. `.ai/rules.md`
2. `.ai/workflow.md`
3. `.ai/agents.md`
4. `docs/CONVENTIONS.md`
5. `docs/API-PATTERNS.md` for API or HTTP work

## Commands

| Command | Use |
|---------|-----|
| `/kickoff` | Plan work with required task schema |
| `/implement` | Execute plan tasks with specialist dispatch |
| `/review` | Run review gate |
| `/ship` | Run release-readiness gate |

## Project commands

- Test: `jest`
- Lint: `npm run lint`
- Build: `npm run build`

## Notes

- Prefer concise responses with file-path pointers.
- Update `docs/ARCHITECTURE.md` for cross-module architecture changes.
