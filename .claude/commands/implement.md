# /implement — ats-fit-backend

## Goal

Execute an implementation plan using Agency specialists via Claude Code's native `subagent_type` — never `general-purpose`.

## Superpowers phase gate (non-negotiable)

Complete these **before** pre-flight and execution. If a skill path is missing under `.claude/skills/`, stop and tell the user to run `npx ai-dev-setup init --vendor-only --force`.

1. **using-superpowers** — Invoke the Skill tool for `.claude/skills/using-superpowers/` (or read `SKILL.md` there).
2. **subagent-driven-development** — Read `.claude/skills/subagent-driven-development/` (implementer prompt, reviewer prompts, orchestration). Apply its transport and review gates; substitute Agency `subagent_type` per this command’s execution rules (never `general-purpose` for implementers).
3. After all tasks: **verification-before-completion** — Load `.claude/skills/verification-before-completion/` and satisfy it before claiming the run is done (evidence: commands run, outcomes stated).

## Before running this command

1. You have a **plan** from `/kickoff` (or another source) with **tasks**, **paths**, and an **Agency `subagent_type`** assigned per task (exact string, e.g. `engineering-backend-architect`).
2. `vendor/` is present and `.claude/agents/` contains division-prefixed Agency files (e.g. `engineering-backend-architect.md`, not `backend-architect.md`).

## Pre-flight verification (do this first, do not skip)

1. **Read `.claude/agents/_index.json`.** If it does not exist, `vendor/` is stale — stop and tell the user to run `npx ai-dev-setup init --vendor-only --force`.
2. **For every task in the plan, confirm its assigned `subagent_type` appears in `_index.json`.** If any role is missing, stop and report which task → which missing role. Do not substitute `general-purpose`. Do not guess a close match silently — ask the user to either pick a replacement from `_index.json` or update `vendor/`.
3. Only after all roles resolve, proceed to execution.

## Execution rules

1. **Dispatch each task with the Agency `subagent_type` directly** — Claude Code auto-loads the full persona from `.claude/agents/<subagent_type>.md`:

   ```
   Task({
     subagent_type: "engineering-backend-architect",   // from the plan, never "general-purpose"
     description: "Implement Task N: <short name>",
     prompt: "<full task spec + scene-setting context from the plan>"
   })
   ```

2. **Substitute for Superpowers' template.** `.claude/skills/subagent-driven-development/implementer-prompt.md` shows `Task tool (general-purpose)`. You MUST replace `general-purpose` with the plan's assigned Agency `subagent_type` on every dispatch. The Superpowers body (task text, context, self-review protocol) still applies — only the `subagent_type` parameter changes.

3. **Two-stage review stays as Superpowers defines it.** After the implementer finishes, dispatch the spec-compliance reviewer and code-quality reviewer per `subagent-driven-development` — do **not** substitute Agency roles for those; they are gates, not implementers.

4. **If the plan did not name a role for a task:** map it per `.ai/agents.md` tables (API/server → `engineering-backend-architect`, UI → `engineering-frontend-developer`, tests → `testing-api-tester`, infra → `engineering-devops-automator`, etc.) **before** dispatching. Update the plan file with the assignment so the decision is traceable.

5. **Run `npm run test` / `npm run lint`** after each task; `/review` handles pre-merge gates. If the user then asks to ship or open a PR, follow **`.claude/commands/ship.md`** (full verify + git + PR sequence).

## Anti-patterns (will produce bad work)

- Dispatching with `subagent_type: "general-purpose"` and a one-line "You are operating as Backend Architect" intro. This discards the 200+ lines of persona in the real agent file.
- Manually opening the agent `.md` with Read and pasting pieces into the subagent prompt. Unnecessary — `subagent_type` loads it automatically.
- Using bare names like `backend-architect` or `qa-tester`. These do not resolve; the real files are division-prefixed.
- Skipping pre-flight verification. A missing agent causes silent fallback to generic output.

## Output format

- Smallest vertical slice first (build, test, review cycle)
- Keep diffs reviewable — one concern per task
- Link errors to `.ai/rules.md` or `docs/ERROR-HANDLING.md` when exceptions occur
