---
doc_type: domain-spec
status: draft
owner: TBD
last_reviewed: 2026-04-06
---

# ATS matching

## Business intent

Give users **actionable signal** on how well their resume matches a **specific job description**, persist **history** for comparison over time, and allow **reuse of processed resume content** when eligible—so users iterate before applying.

## Traceability

| ID | Kind |
|----|------|
| REQ-006 | Functional |
| REQ-009 | Functional (limits + usage tracking) |
| US-3 | User story |

## Acceptance criteria

- [ ] **AC-ATS-01:** User can submit JD + resume (file and/or structured content per DTO) and receive a structured score response.
- [ ] **AC-ATS-02:** Score endpoint enforces **rate limits** and records usage where `UsageTrackingInterceptor` applies.
- [ ] **AC-ATS-03:** Authenticated user can fetch **available processed resume** info when feature rules allow.
- [ ] **AC-ATS-04:** User can fetch ATS **history** for a user id with **plan-bounded** retention as implemented in service.
- [ ] **AC-ATS-05:** History access respects **authorization** rules (caller vs `userId`—verify in code when changing).

## Score

- **`POST /ats-match/score`** — **Public**; **`@RateLimitFeature(ATS_SCORE)`**; may use **`UsageTrackingInterceptor`** so usage is recorded.
- **Input:** JSON body (`AtsScoreRequestDto`: job description, optional company name, optional structured `resumeContent`) plus optional multipart **`resumeFile`**.
- **Context:** Uses `request.userContext` for attribution and limits.
- **Output:** `AtsScoreResponseDto` (shape in code—scores, analysis summary, etc.).

## Available processed resume (registered feature gate)

- **`GET /ats-match/available-resumes`** — JWT required; returns processed resume info for users allowed to use pre-processed content.

## Match history

- **`GET /ats-match/history/:userId`** — Authenticated; optional `fields` query for sparse projection.
- **Access control:** Caller must align with **authorized** user for that `userId` (enforce in service/guard patterns—verify in code when changing).
- **Retention window:** History depth is constrained by **plan/type** via rate-limit config for `FeatureType.ATS_SCORE_HISTORY` (`monthly_limit` interpreted as **allowed days** of history in the service—confirm in `ats-match-history.service` when modifying).

## Related specs

- Limits and usage: [08-rate-limits-and-usage.md](./08-rate-limits-and-usage.md)
- Extraction that feeds “available resumes”: [04-profile-enrichment.md](./04-profile-enrichment.md)
- Requirements: [functional-requirements.md](./functional-requirements.md)
