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

## Dispatch rules (non-negotiable)

**NEVER dispatch an implementation Task with `subagent_type: "general-purpose"`.** Every implementation worker is bound to an Agency specialist via Claude Code's native `subagent_type` mechanism.

### Rule 1 — Use `subagent_type`, not manual file loading

Claude Code auto-loads the full Agency persona (all constraints, anti-patterns, deliverables) when you pass the matching `subagent_type`. Do **not** Read the file manually and paste it into a prompt — that is obsolete. Dispatch like this:

```
Task({
  subagent_type: "engineering-backend-architect",   // exact filename, no .md
  description: "Implement Task N: <short name>",
  prompt: "<task spec + context from the plan>"
})
```

### Rule 2 — Agency filenames use division prefixes

The agent files in `.claude/agents/` come from upstream and are named with a **division prefix** (`engineering-`, `testing-`, `product-`). Bare names like `backend-architect` do **not** resolve. Authoritative mapping lives in **`.claude/agents/_index.json`** (written by `ai-dev-setup`). The common roles are:

| Task focus | `subagent_type` |
|------------|-----------------|
| API / backend / server logic | `engineering-backend-architect` |
| UI / frontend / components | `engineering-frontend-developer` |
| Tests / API testing | `testing-api-tester` |
| Performance / benchmarking | `testing-performance-benchmarker` |
| Infra / CI / scripts | `engineering-devops-automator` |
| System architecture | `engineering-software-architect` |
| Code review | `engineering-code-reviewer` |
| Security review | `engineering-security-engineer` |
| Documentation | `engineering-technical-writer` |
| Product / scope / requirements | `product-manager` |
| Senior generalist dev | `engineering-senior-developer` |

When the plan is silent on roles, map tasks using this table before dispatching. If a role you want is not present, open `.claude/agents/_index.json` and pick the closest match.

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
