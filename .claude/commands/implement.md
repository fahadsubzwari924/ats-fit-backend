# /implement — ats-fit-backend

## Goal

Execute an implementation plan using Agency specialists via Claude Code's native `subagent_type` — never `general-purpose`.

## Superpowers phase gate

Run these before continuing:
1. `using-superpowers`
2. Phase skill for this task:
   - bugs/failing tests -> `systematic-debugging`
   - new feature/unclear scope -> `brainstorming` then `writing-plans`
   - implementation -> `subagent-driven-development`
   - review -> `requesting-code-review`
   - ship -> `verification-before-completion`


## Before running this command

1. You have a **plan** from `/kickoff` (or another source) with **tasks**, **paths**, and an **Agency `subagent_type`** assigned per task (`.claude/agents/_index.json` `subagentType` value).
2. `vendor/` is present and `.claude/agents/` contains division-prefixed Agency files (e.g. `engineering-backend-architect.md`).

## Pre-flight verification (do this first, do not skip)

1. **Read `.claude/agents/_index.json`.** If it does not exist, `vendor/` is stale — stop and tell the user to run `npx ai-dev-setup init --vendor-only --force`.
2. **For every task in the plan, confirm its assigned `subagent_type` appears as a `subagentType` value in `_index.json`.** Also capture that entry's `subagentTypeCandidates` fallback order. If any role is missing, stop and report which task → which missing role. Do not substitute `general-purpose`.
3. Only after all roles resolve, proceed to execution.

## Execution rules

1. **Dispatch each task with the Agency `subagent_type` directly** (primary = `_index.json` `subagentType`):

   ```
   Task({
     subagent_type: "Backend Architect",   // primary value from _index.json
     description: "Implement Task N: <short name>",
     prompt: "<full task spec + scene-setting context from the plan>"
   })
   ```

2. **Compatibility fallback if dispatch fails:** retry with the same agent entry's `subagentTypeCandidates` in order (for example display-name, slug, file-based alias). Stop only if all candidates fail. Never substitute `general-purpose` for implementation work.

3. **Substitute for Superpowers' template.** `.claude/skills/subagent-driven-development/implementer-prompt.md` shows `Task tool (general-purpose)`. You MUST replace `general-purpose` with Agency role dispatch on every task. The Superpowers body (task text, context, self-review protocol) still applies — only `subagent_type` resolution changes.

4. **Two-stage review stays as Superpowers defines it.** After the implementer finishes, dispatch the spec-compliance reviewer and code-quality reviewer per `subagent-driven-development` — do **not** substitute Agency roles for those; they are gates, not implementers.

5. **If the plan did not name a role for a task:** map it per `.ai/agents.md` tables (API/server → `Backend Architect`, UI → `Frontend Developer`, tests → `API Tester`, infra → `DevOps Automator`, etc.) **before** dispatching, then resolve from `_index.json` and attach fallback candidates in task notes.

6. **Run `jest` / `npm run lint`** after each task; `/review` handles pre-merge gates.

## Anti-patterns (will produce bad work)

- Dispatching with `subagent_type: "general-purpose"` and a one-line "You are operating as Backend Architect" intro. This discards the 200+ lines of persona in the real agent file.
- Manually opening the agent `.md` with Read and pasting pieces into the subagent prompt. Unnecessary — `subagent_type` loads it automatically.
- Assuming one naming format always works. Use `_index.json` `subagentType` first, then `subagentTypeCandidates` fallback order.
- Skipping pre-flight verification. A missing agent causes silent fallback to generic output.

## Output format

- Smallest vertical slice first (build, test, review cycle)
- Keep diffs reviewable — one concern per task
- Link errors to `.ai/rules.md` or `docs/ERROR-HANDLING.md` when exceptions occur
