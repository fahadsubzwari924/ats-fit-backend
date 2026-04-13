# /kickoff — ats-fit-backend

## Goal

Turn a feature request into a bounded plan aligned with `.ai/workflow.md` and Agency specialists.

## Steps

1. Restate objective and **non-goals** (3–7 bullets)
2. List unknowns; ask **one** blocking question if needed
3. Propose architecture touchpoints with links to `docs/ARCHITECTURE.md` sections to update
4. Emit a task list: each task must have **path**, **change**, **verify** (`npm run test` / manual check), and **Agency `subagent_type`** — the exact string you will pass to the Task tool when dispatching, pulled from `.ai/agents.md` or `.claude/agents/_index.json` (e.g. `engineering-backend-architect`, `engineering-frontend-developer`, `testing-api-tester`). Bare names like `backend-architect` will not resolve.

## Output format

- ### Summary
- ### Risks
- ### Tasks (numbered, each with: path, change, verify, `subagent_type` assigned)
