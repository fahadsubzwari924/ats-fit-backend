# /review — ats-fit-backend

## Goal

Catch correctness, safety, and maintainability issues before merge.

## Superpowers phase gate (non-negotiable)

Complete these **before** the checklist and findings. If a skill path is missing under `.claude/skills/`, stop and tell the user to run `npx ai-dev-setup init --vendor-only --force`.

1. **using-superpowers** — Invoke the Skill tool for `.claude/skills/using-superpowers/` (or read `SKILL.md` there).
2. **requesting-code-review** — Load `.claude/skills/requesting-code-review/` and align your review depth and structure with it.
3. **verification-before-completion** — Load `.claude/skills/verification-before-completion/`; do not claim approve without evidence (e.g. `npm run test` / `npm run lint` outcomes or explicit gaps).

## Checklist

- [ ] Matches stated acceptance checks
- [ ] Errors handled at boundaries per `docs/ERROR-HANDLING.md`
- [ ] Tests updated or gap documented (`npm run test`)
- [ ] No secrets / PII in logs
- [ ] Public API or behavior change reflected in docs
- [ ] `npm run lint` clean or waivers explained inline

## Output format

- ### Findings (severity: high/med/low)
- ### Suggested patches (file-scoped)
- ### Merge verdict: approve | changes requested
