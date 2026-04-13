# /review — ats-fit-backend

## Goal

Catch correctness, safety, and maintainability issues before merge.

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
