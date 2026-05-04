# /review — ats-fit-backend

## Goal

Catch correctness, safety, and maintainability issues before merge.

## Superpowers phase gate

Run these before continuing:
1. `using-superpowers`
2. Phase skill for this task:
   - bugs/failing tests -> `systematic-debugging`
   - new feature/unclear scope -> `brainstorming` then `writing-plans`
   - implementation -> `subagent-driven-development`
   - review -> `requesting-code-review`
   - ship -> `verification-before-completion`


## Checklist

- [ ] Matches stated acceptance checks
- [ ] Errors handled at boundaries per `docs/ERROR-HANDLING.md`
- [ ] Tests updated or gap documented (`jest`)
- [ ] No secrets / PII in logs
- [ ] Public API or behavior change reflected in docs
- [ ] `npm run lint` clean or waivers explained inline

## Output format

- ### Findings (severity: high/med/low)
- ### Suggested patches (file-scoped)
- ### Merge verdict: approve | changes requested
