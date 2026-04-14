# /ship — ats-fit-backend

## Goal

1. **Ship readiness** — confirm quality gates with evidence.
2. **Create a GitHub PR** — when shipping includes opening a PR, follow **PR workflow (mandatory)** in order.

## When this applies (strict)

Follow this file end-to-end for:

- `/ship`
- Natural language such as “create the PR”, “ship this feature”, “open a pull request”, “push and PR”, unless the user explicitly opts out of git/PR steps.

Use **verification-before-completion**: cite command output for every pass/fail; do not claim green without reruns after fixes.

## Superpowers phase gate (non-negotiable)

Complete these **before** the final ship status. If a skill path is missing under `.claude/skills/`, stop and tell the user to run `npx ai-dev-setup init --vendor-only --force`.

1. **using-superpowers** — Invoke the Skill tool for `.claude/skills/using-superpowers/` (or read `SKILL.md` there).
2. **verification-before-completion** — Load `.claude/skills/verification-before-completion/`; every “passes” claim must cite command output or a documented waiver.

## PR workflow (mandatory when creating a PR or “shipping” with branch + PR)

Execute **in this order**. If a step fails, fix issues, then **restart from step 1** for that section until all three verification commands pass.

### 1. Verify (tests → build → lint)

1. `npm run test` — full suite; fix failures; re-run until pass.
2. `npm run build` — fix errors; re-run until pass.
3. `npm run lint` — fix issues; re-run until pass.

### 2. Branch, latest base, push, open PR

**Inputs:** If the user has not given a **task identifier** (e.g. `PROJ-123`) and whether the work is a **feature** or **bugfix**, ask before creating the branch.

**Default base branch:** `master` (use `main` only if this repo’s default remote branch is `main`).

1. **Stash** — If the working tree is dirty (`git status --porcelain` non-empty):  
   `git stash push -u -m "pre-ship"`  
   If clean, skip stash and state that explicitly.

2. **Checkout and update base** — `git checkout master` then `git pull --ff-only origin master` (or equivalent safe fast-forward pull).

3. **Create branch** — From updated `master`:  
   - Feature work: `git checkout -b feature/<TASK-ID>`  
   - Bugfix work: `git checkout -b bugfix/<TASK-ID>`  

4. **Restore local changes** — If you stashed: `git stash pop`. Resolve conflicts; then repeat **Verify (tests → build → lint)** above on this branch.

5. **Commit** — If there are uncommitted changes after pop, commit with a clear message (project’s conventional commit style if used).

6. **Push** — `git push -u origin HEAD`.

7. **Create PR** — Prefer GitHub CLI:  
   `gh pr create --base master --head <branch> --title "..." --body "..."`  
   If `gh` is unavailable or unauthenticated, give the push result and a compare URL the user can open.

### Commits already on another branch

If work only exists as commits on a different branch, do not discard history: after creating `feature/<TASK-ID>` or `bugfix/<TASK-ID>` from updated `master`, **cherry-pick** the needed commits (or ask whether to reuse/rename the existing branch). Never `reset --hard` or force-push without explicit user approval.

## Ship readiness only (no PR / no new branch)

If the user wants **only** a readiness check, run **Verify (tests → build → lint)** and the optional checklist below; skip **Branch, latest base, push, open PR** unless they ask for a branch or PR.

## Optional release checklist

- [ ] Changelog / release notes updated when user-visible
- [ ] Migrations or feature flags documented when applicable

## Output format

- ### Ship status: ready | blocked
- ### PR: link (if created) or skipped (with reason)
- ### Blockers (if any)
- ### Rollback notes
