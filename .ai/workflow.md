# Development workflow — ats-fit-backend

## Default workflow engine (Superpowers)

For **any** work type—feature, bugfix, idea/spike, refactor, documentation, or review prep—default to **Superpowers** skills for phase discipline: choose the skill that matches the moment (e.g. brainstorming, planning, TDD, debugging, verification). Use this document and `.ai/agents.md` for repo-specific steps and Agency role fit. Opt out only when the user explicitly says so.

## Lifecycle

1. **Understand** — restate goal, constraints, acceptance checks (3–7 bullets)
2. **Design** — data flow, boundaries, failure modes; link to `docs/ARCHITECTURE.md` updates if structure changes
3. **Plan** — ordered tasks with file paths, verification per task, and **Agency specialist per task** (use `/kickoff` or `.ai/agents.md` mapping)
4. **Implement** — smallest vertical slice first; keep diffs reviewable. Always bind implementation workers to an **Agency specialist** per plan or `.ai/agents.md`—use `/implement` or Superpowers subagent-driven-development with Agency role prepended to each task
5. **Review** — run `npm run lint` and `npm run test`; fix or document exceptions
6. **Ship** — conventional commit; PR notes include risk + rollback

## Plan execution modes

**Both modes require Agency specialists per task.** The difference is how tasks are dispatched:

| Mode | How tasks run | Agency binding |
|------|---------------|-----------------|
| Sub-agent driven | Each task isolated in fresh context with Superpowers orchestration | REQUIRED: prepend Agency role to each subagent prompt; use `/implement` command or manually load `.ai/agents/<role>.md` |
| Session-wise | Tasks sequential in current session | REQUIRED: use `/implement` or inline `.ai/agents/<role>.md` before each task |

**Key:** "Sub-agent driven" describes the **transport/isolation**, not the **persona**. Persona always comes from Agency.

## TDD (when tests exist)

- **Red** — write a failing test that encodes the requirement
- **Green** — minimal code to pass
- **Refactor** — structure and names; keep tests green

Skip TDD only when user explicitly opts out or project has no harness yet—then add the smallest harness first.

## Planning standards

| Rule | Target |
|------|--------|
| Task size | Completable in one focused session |
| Task description | Verb + object + location (path or module) |
| Verification | Command or observable outcome per task |

## Review checklist (self)

- [ ] Behavior matches acceptance checks
- [ ] Errors surfaced with actionable messages
- [ ] New logic covered by tests or documented gap
- [ ] No new secrets or sensitive logs
- [ ] Docs updated when public behavior or architecture changed

## Commands (local)

| Step | Command |
|------|---------|
| Lint | `npm run lint` |
| Test | `npm run test` |
| Build | `npm run build` |
