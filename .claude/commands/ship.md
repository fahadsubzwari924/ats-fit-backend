# /ship — ats-fit-backend

## Goal

Confirm release/merge readiness.

## Superpowers phase gate (non-negotiable)

Complete these **before** the ship status. If a skill path is missing under `.claude/skills/`, stop and tell the user to run `npx ai-dev-setup init --vendor-only --force`.

1. **using-superpowers** — Invoke the Skill tool for `.claude/skills/using-superpowers/` (or read `SKILL.md` there).
2. **verification-before-completion** — Load `.claude/skills/verification-before-completion/`; every “passes” claim must cite command output or documented waiver.

## Verify

- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes (if applicable)
- [ ] Changelog / release notes updated when user-visible
- [ ] Migrations or feature flags documented

## Output format

- ### Ship status: ready | blocked
- ### Blockers (if any)
- ### Rollback notes
