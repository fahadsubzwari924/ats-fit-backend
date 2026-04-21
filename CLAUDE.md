# ats-fit-backend — Claude Code

## Identity

| Field | Value |
|-------|-------|
| Language | TypeScript |
| Framework | NestJS |
| Database | SQL (TypeORM) |

## Core stack (required)

| System | Location | Role |
|--------|----------|------|
| Superpowers (obra) | `vendor/superpowers/`, skills in `.claude/skills/` | **Default workflow for all work:** features, bugs, ideas/spikes, refactors, docs, and reviews—invoke the matching Superpowers skills (brainstorming, planning, TDD, debugging, review, etc.) unless the user opts out |
| Agency Agents | `vendor/agency-agents/`, agents in `.claude/agents/` | **Default specialists:** pick the agent that matches the task from `.ai/agents.md` |

Do not treat Superpowers or Agency as optional add-ons. If `vendor/` is missing, run `npx ai-dev-setup init` without `--skip-vendor`.

## Every message / every task (non-negotiable)

Same contract as Cursor’s always-on `routing.mdc`: **Superpowers** for phase discipline, **Agency** for execution. Applies whether the user typed a slash command or started a random conversation.

- **Default:** Use Superpowers skills for the current phase (brainstorming, writing-plans, systematic-debugging, subagent-driven-development, verification-before-completion, requesting-code-review, test-driven-development, etc.). Use Agency specialists for every implementation Task (`subagent_type` from `.claude/agents/_index.json`). Override only when the user opts out explicitly.
- **Bug, error, or failing test:** systematic-debugging → then plan/implement with the right Agency role (e.g. `API Tester` for tests, `Backend Architect` for server logic).
- **New feature or unclear scope:** brainstorming when creativity/requirements are unclear → writing-plans → implement with Agency per task.
- **Review or ship:** requesting-code-review / review skills plus verification-before-completion; keep Agency on implementation work, not on Superpowers reviewer **gates** (see Rule 4).
- **PLANNING:** Every plan task must have an Agency `subagent_type` before the plan is final (same as `/kickoff`). If a skill omits roles, add them from `.ai/agents.md` / `_index.json`.
- **DISPATCH:** Never `general-purpose` for implementers — Rules 1–5 below.

SessionStart (`.claude/settings.json`) injects **using-superpowers** when the session starts; still follow the phase gate in slash commands and here for every turn.

## Dispatch rules (non-negotiable)

**NEVER dispatch an implementation Task with `subagent_type: "general-purpose"`.** Every implementation worker is bound to an Agency specialist via Claude Code's native `subagent_type` mechanism.

### Rule 1 — Use `subagent_type`, not manual file loading

Claude Code auto-loads the full Agency persona (all constraints, anti-patterns, deliverables) when you pass the matching `subagent_type`. Do **not** Read the file manually and paste it into a prompt — that is obsolete. Dispatch like this:

```
Task({
  subagent_type: "Backend Architect",   // frontmatter name field, not the filename
  description: "Implement Task N: <short name>",
  prompt: "<task spec + context from the plan>"
})
```

### Rule 2 — `subagent_type` is the frontmatter `name`, not the filename

The agent files in `.claude/agents/` are named with a **division prefix** (`engineering-`, `testing-`, `product-`), but Claude Code matches on the **`name` field** in each file's YAML frontmatter — not on the filename stem. Authoritative mapping lives in **`.claude/agents/_index.json`** (`subagentType` field, written by `ai-dev-setup`). The common roles are:

| Task focus | `subagent_type` |
|------------|-----------------|
| API / backend / server logic | `Backend Architect` |
| UI / frontend / components | `Frontend Developer` |
| Tests / API testing | `API Tester` |
| Performance / benchmarking | `Performance Benchmarker` |
| Infra / CI / scripts | `DevOps Automator` |
| System architecture | `Software Architect` |
| Code review | `Code Reviewer` |
| Security review | `Security Engineer` |
| Documentation | `Technical Writer` |
| Product / scope / requirements | `Product Manager` |
| Senior generalist dev | `Senior Developer` |

When the plan is silent on roles, map tasks using this table before dispatching. If a role you want is not present, open `.claude/agents/_index.json` and use the `subagentType` value from the matching entry.

### Rule 3 — Override Superpowers' `subagent-driven-development` template

`.claude/skills/subagent-driven-development/implementer-prompt.md` shows `Task tool (general-purpose)`. **You MUST substitute** the Agency `subagent_type` from Rule 2 when you actually dispatch. Superpowers defines *transport* (fresh context, two-stage review, status handling); Agency defines *persona*. Both apply together. Treating the Superpowers template literally — i.e. passing `general-purpose` — discards the entire Agency system and produces generic output. Do not do this.

This substitution is also required for `/implement`, `/kickoff`-generated plans, and any ad-hoc Task dispatch you perform while executing work in this repo.

### Rule 4 — Reviewer subagents keep their Superpowers role

Superpowers' spec-compliance and code-quality reviewer subagents (`spec-reviewer-prompt.md`, `code-quality-reviewer-prompt.md`) are **gates**, not implementers. Dispatch them as Superpowers defines — do **not** override with Agency specialists.

### Rule 5 — Fail loudly on missing agents

Before dispatching, if the `subagent_type` you intend to use is not present in `.claude/agents/_index.json`, stop and report it. Do not silently fall back to `general-purpose`. A missing agent means `vendor/` is broken or outdated — re-run `npx ai-dev-setup init --vendor-only --force`.

## Read first (onboarding)

| Order | File |
|-------|------|
| 1 | `.ai/rules.md` — engineering principles, anti-patterns, layer rules |
| 2 | `.ai/workflow.md` |
| 3 | `docs/CONVENTIONS.md` — stack-specific patterns (layer separation, constants, validation) |
| 4 | `docs/ARCHITECTURE.md` (fill if empty) |

Load `docs/API-PATTERNS.md` on every task that touches HTTP routes or request handling.

## Operating rules

- Prefer repo scripts: test `npm run test`, lint `npm run lint`, build `npm run build`
- Keep replies short; point to paths instead of pasting large files
- After structural change, update `docs/ARCHITECTURE.md` in the same PR when behavior crosses modules
- Let Superpowers skills drive phase gates; align with `.ai/workflow.md` without duplicating long prose here

## Slash commands

| Command | Use |
|---------|-----|
| `/kickoff` | New feature: scope, risks, plan with Agency role per task |
| `/implement` | Execute a plan: wires Agency specialists + quality checks |
| `/review` | Pre-merge review checklist |
| `/ship` | Release/merge readiness |

## Docs index

| Topic | Path |
|-------|------|
| Conventions | `docs/CONVENTIONS.md` |
| Testing | `docs/TESTING-STRATEGY.md` |
| API | `docs/API-PATTERNS.md` |
| Errors | `docs/ERROR-HANDLING.md` |
| Security | `docs/SECURITY.md` |

## Out of scope for this file

- Do not duplicate `.ai/rules.md`
- Do not paste long examples—add them under `docs/` and link
