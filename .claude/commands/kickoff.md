# /kickoff — ats-fit-backend

## Goal

Turn a feature request into a bounded plan aligned with `.ai/workflow.md` and Agency specialists.

## Superpowers phase gate

Run these before continuing:
1. `using-superpowers`
2. Phase skill for this task:
   - bugs/failing tests -> `systematic-debugging`
   - new feature/unclear scope -> `brainstorming` then `writing-plans`
   - implementation -> `subagent-driven-development`
   - review -> `requesting-code-review`
   - ship -> `verification-before-completion`


## Steps

1. Restate objective and **non-goals** (3–7 bullets)
2. List unknowns; ask **one** blocking question if needed
3. Propose architecture touchpoints with links to `docs/ARCHITECTURE.md` sections to update
4. Emit a task list: each task must have **path**, **change**, **verify** (`jest` / manual check), and **Agency `subagent_type`** from `.claude/agents/_index.json` (`subagentType` field). If dispatch fails later, executor retries using that entry's `subagentTypeCandidates` order.

## Output format

- ### Summary
- ### Risks
- ### Tasks (numbered, each with: path, change, verify, `subagent_type` assigned)
