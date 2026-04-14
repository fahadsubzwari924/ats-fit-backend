# Development workflow — ats-fit-backend

## Default workflow engine (Superpowers)

For **any** work type—feature, bugfix, idea/spike, refactor, documentation, or review prep—default to **Superpowers** skills under `.claude/skills/<skill-name>/` for phase discipline. Use this document and `.ai/agents.md` for repo-specific steps and Agency role fit. Opt out only when the user explicitly says so.

**Claude Code:** Slash commands (`/kickoff`, `/implement`, `/review`, `/ship`) are thin wrappers around this lifecycle—they add explicit Superpowers phase gates; still follow `.ai/agents.md` for Agency mapping. **SessionStart** in `.claude/settings.json` runs `vendor/superpowers/hooks/session-start` so new sessions get **using-superpowers** injected automatically (requires `vendor/superpowers/`).

**Cursor:** Always-on `routing.mdc` enforces the same combo; use the Superpowers plugin plus `@agency-*.mdc` per task.

## Lifecycle (map each step to Superpowers skills + Agency)

| Phase | What to do | Superpowers skills (typical) | Agency |
|-------|------------|------------------------------|--------|
| **Understand** | Restate goal, constraints, acceptance (3–7 bullets) | using-superpowers; systematic-debugging if bug-first | Pick roles from `.ai/agents.md` for later tasks |
| **Design** | Data flow, boundaries, failure modes; link `docs/ARCHITECTURE.md` | brainstorming when shape is unclear | — |
| **Plan** | Ordered tasks: path, verify, **specialist per task** | writing-plans | One Agency specialist per task (`subagent_type` or `@agency-*.mdc`) |
| **Implement** | Smallest vertical slice; reviewable diffs | subagent-driven-development; test-driven-development when harness exists | **Required** on every implementation worker — `/implement` or equivalent |
| **Review** | Lint/test evidence | requesting-code-review; verification-before-completion | Reviewer/security roles where appropriate; not for Superpowers **gate** reviewers inside subagent-driven-development |
| **Ship** | Merge/release readiness, PR creation | verification-before-completion; **`.claude/commands/ship.md`** (mandatory test → build → lint order; stash → `master`+pull → `feature|bugfix/<task>` → push → PR when user ships or asks for a PR) | — |

Repo commands: `npm run lint`, `npm run test`, `npm run build`.

### Ship and GitHub PR (must match `ship` command)

When the user runs `/ship` or asks to **create/open a PR** or **ship the feature**, follow **`.claude/commands/ship.md`** exactly:

1. `npm run test` → `npm run build` → `npm run lint` (fix and re-run until all pass).
2. Stash if dirty → `checkout master` → pull latest → `checkout -b feature/<TASK>` or `bugfix/<TASK>` → `stash pop` if applicable → re-verify if needed → commit → push → `gh pr create` (or compare URL).

If the task id or feature vs bugfix is missing, ask before naming the branch.

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

Ship/PR verification order: **test → build → lint** (see `.claude/commands/ship.md`).

| Step | Command |
|------|---------|
| Test | `npm run test` |
| Build | `npm run build` |
| Lint | `npm run lint` |
