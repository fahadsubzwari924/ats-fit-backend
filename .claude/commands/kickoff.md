# /kickoff — ats-fit-backend

## Goal

Turn a feature request into a bounded plan aligned with `.ai/workflow.md` and Agency specialists.

## Superpowers phase gate (non-negotiable)

Complete these **before** emitting the Summary / Risks / Tasks sections below. If a skill path is missing under `.claude/skills/`, stop and tell the user to run `npx ai-dev-setup init --vendor-only --force`.

1. **using-superpowers** — Invoke the Skill tool for `.claude/skills/using-superpowers/` (or read `SKILL.md` there). Follow it for how to load other skills.
2. **Classify work** — Bug, regression, or failing test → load **systematic-debugging** (`.claude/skills/systematic-debugging/`) before planning fixes. Greenfield or unclear product shape → load **brainstorming** (`.claude/skills/brainstorming/`) before locking scope.
3. **writing-plans** — Load `.claude/skills/writing-plans/` and follow its planning discipline for the ordered task list you will output.
4. **Agency** — Every emitted task must still include **Agency `subagent_type`** per the steps below (Superpowers = phase discipline; Agency = who implements each task).

## Steps

1. Restate objective and **non-goals** (3–7 bullets)
2. List unknowns; ask **one** blocking question if needed
3. Propose architecture touchpoints with links to `docs/ARCHITECTURE.md` sections to update
4. Emit a task list: each task must have **path**, **change**, **verify** (`npm run test` / manual check), and **Agency `subagent_type`** — the exact string you will pass to the Task tool when dispatching, pulled from `.ai/agents.md` or `.claude/agents/_index.json` (e.g. `engineering-backend-architect`, `engineering-frontend-developer`, `testing-api-tester`). Bare names like `backend-architect` will not resolve.

## Output format

- ### Summary
- ### Risks
- ### Tasks (numbered, each with: path, change, verify, `subagent_type` assigned)
