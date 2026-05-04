# 13 — Resume Tailoring Prompt Pipeline Improvement Plan

> Status: IN PROGRESS (Phase 0 complete)
> Owner: Backend / AI
> Last updated: 2026-05-01
> Companion specs: [03-resume-tailoring.md](./03-resume-tailoring.md), [04-profile-enrichment.md](./04-profile-enrichment.md)

## Implementation constraints

- **No unit tests** — skip all unit/integration test writing across all phases. Testing happens via `npm run test:prompts` (golden-set harness) only.
- **No mid-task commits** — commits are created only when explicitly requested. Work accumulates unstaged/staged until the user asks to commit.

## 1. Context & motivation

The resume tailoring pipeline is the core product surface. Two audits (structural + 2026 prompt-quality) graded the current 7-prompt suite at **B-** overall:

- Structural: no Anthropic prompt caching, regex JSON extraction, `gpt-4-turbo` fallback, no numeric-claim verifier, JSON dumped inline killing cache, near-duplicate optimization prompts drifting.
- Quality: zero few-shot examples, generic "expert" personas, no reasoning scaffold, no per-bullet rubric, no verb taxonomy / banned-phrase denylist, weak cover-letter prompt, missing recruiting-domain depth.

This plan sequences the fixes in five phases with foundation-first ordering so that each later phase can be measured. **Total effort: ~13 dev-days for Phases 0–3; Phase 4 optional.**

## 2. Pipeline inventory (current state)

| # | Stage | Service | Provider / Model | Temp | Tokens | Output |
|---|-------|---------|------------------|------|--------|--------|
| 1 | Resume extraction | `ai-content.service.ts` | OpenAI `gpt-4o` | 0 | 4096 | `json_schema` strict |
| 2 | JD analysis | `job-analysis.service.ts` | OpenAI `gpt-4o-mini` | 0.05 | 1500 | `json_object` |
| 3 | Optimization (primary) | `resume-optimizer.service.ts` | Anthropic `claude-sonnet-4` | 0.2 | 8000 | freeform → regex JSON |
| 4 | Optimization (fallback) | `resume-optimizer.service.ts` | OpenAI `gpt-4-turbo` | 0.2 | 8000 | `json_object` |
| 5 | Profile question gen | `profile-question-generation.service.ts` | OpenAI `gpt-4o-mini` | 0.3 | 2000 | `json_object` |
| 6 | Profile enrichment | `resume-profile-enrichment.service.ts` | Anthropic `claude-haiku-4-5` | 0.2 | 2000 | freeform → regex JSON |
| 7 | Cover letter | `cover-letter-generation.service.ts` | Anthropic `claude-sonnet-4` | 0.3 | 1500 | freeform → regex JSON |

All prompts live in `src/shared/services/prompt.service.ts` (lines 11–667).

## 3. Goals & success metrics

| KPI | Today | Phase 1 target | Phase 3 target |
|-----|-------|----------------|----------------|
| Cost per tailored resume | baseline (X) | 0.50 X | 0.45 X |
| JSON parse failure rate | unknown / observed via logs | <0.5% | <0.1% |
| Hallucinated-metric incidence (golden set) | not measured | <5% | <1% |
| Prompt grade vs. SOTA (internal rubric) | B- | B+ | A− / A |
| Cache-read token ratio (Anthropic) | 0% | >50% | >70% |
| `cache_creation_input_tokens / total_input` | n/a | <30% | <15% |

## 4. Phase 0 — Foundation (Week 1, ~2 days)

Prerequisite scaffolding. **No prompt edits ship until F1–F4 are in place.**

### F1. Prompt versioning

- Add `PROMPT_VERSION` constants in `prompt.service.ts` per fn (e.g. `RESUME_OPTIMIZATION_PROMPT_VERSION = 'v3.0'`).
- Migrate `resume_generations` table to add `prompt_version VARCHAR(16)` (nullable to start).
- Persist version on every generation row in `resume-optimizer.service.ts`, `cover-letter-generation.service.ts`, `resume-profile-enrichment.service.ts`.
- Include `promptVersion` in cache keys (`resume-optimizer.service.ts:101-112`, `cover-letter-generation.service.ts:123-131`).

**Deliverable:** `feat(prompts): introduce prompt versioning + migration`.

### F2. Centralize model + tuning constants

- Move all hard-coded model strings to `src/modules/resume-tailoring/constants/resume-tailoring.constants.ts`:
  - `MODELS = { resumeExtraction, jdAnalysis, optimizerPrimary, optimizerFallback, profileQuestions, profileEnrichment, coverLetter }`
  - `TEMPERATURES = { ... }` (named per prompt id)
  - `MAX_TOKENS = { ... }`
- Replace inline strings at `ai-content.service.ts:27`, `job-analysis.service.ts:89`, `profile-question-generation.service.ts:132`, `resume-optimizer.service.ts:191,549`, `cover-letter-generation.service.ts:153`.

**Deliverable:** `refactor(prompts): centralize model + tuning constants`.

### F3. Observability decorator

- Wrap `claudeService.chatCompletion` and `openAIService.chatCompletion` with a logging decorator.
- Per-call structured log + PostHog event:
  ```
  { prompt_id, prompt_version, model, input_tokens, output_tokens,
    cache_read_input_tokens, cache_creation_input_tokens,
    latency_ms, retry_count, parse_outcome, fallback_triggered }
  ```
- Add a Grafana / PostHog dashboard tile per prompt id.

**Deliverable:** `feat(observability): per-prompt LLM call telemetry`.

### F4. Golden-set scaffold

- New dir `test/prompts/golden/` containing 5 frozen `(resume.json, jd.json) → expected_output.json` triples (representative spread: junior IC, mid IC, senior IC, EM, career-change).
- New script `npm run test:prompts` runs each prompt against goldens and emits a JSON diff report.
- Initial scorers (lightweight): bullet-count parity, keyword coverage, hallucination heuristic (numeric-token check), banned-phrase scan.
- No unit tests — golden harness is the only automated check.

**Deliverable:** `test(prompts): introduce golden-set evaluation harness`.

## 5. Phase 1 — Reliability + cost (Week 2, ~3 days)

Highest blast radius. Each item independently shippable; sequence chosen to validate observability incrementally.

### P1.1 — OpenAI fallback model swap

- File: `resume-optimizer.service.ts:191, 549`
- `gpt-4-turbo` → `gpt-4o-2024-11-20`
- `response_format: { type: 'json_object' }` → `{ type: 'json_schema', json_schema: { name: 'resume_optimization', strict: true, schema: ResumeOptimizationJsonSchema } }`
- Author `ResumeOptimizationJsonSchema` in `src/modules/resume-tailoring/types/`.

**Validation:** Force-trigger fallback in staging via `CLAUDE_OVERLOAD_SIMULATE=true`; confirm parse + cost via observability.

### P1.2 — Anthropic prompt caching

- Files: `resume-optimizer.service.ts:514-523`, `cover-letter-generation.service.ts:150-154`, `resume-profile-enrichment.service.ts:142-148`.
- Restructure each Claude call:
  ```ts
  client.messages.create({
    system: [
      { type: 'text', text: STATIC_SYSTEM_BLOCK,
        cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: VARIABLE_CONTEXT }],
  })
  ```
- Split each `getX...Prompt` fn in `prompt.service.ts` into `{ system, user }` halves.
- Static halves include: persona, rules, schema, rubric. Variable halves include: JD, resume JSON, verified facts.

**Validation:** First call emits `cache_creation_input_tokens > 0`; subsequent identical-system calls within 5 min emit `cache_read_input_tokens > 0`. KPI: cache-read ratio >50% within 48h of release.

### P1.3 — Claude tool-use replaces regex JSON

- Files: `resume-optimizer.service.ts:282-292`, `cover-letter-generation.service.ts:175-180`, `resume-profile-enrichment.service.ts:215-219`.
- Define Anthropic `tools`:
  - `return_optimized_resume` → `OptimizedResumeJsonSchema`
  - `return_rewritten_bullets` → `RewrittenBulletsJsonSchema`
  - `return_cover_letter` → `CoverLetterJsonSchema`
- Force `tool_choice: { type: 'tool', name }`.
- Read output from `response.content[0].input` (typed); delete regex extraction blocks.

**Validation:** Parse failure rate from telemetry drops to ~0; remove `max_tokens` truncation handling at `resume-optimizer.service.ts:271-280`.

### P1.4 — Numeric-claim verifier

- File: `resume-optimizer.service.ts:201-209` (insert between `sanitizeSummary` and `validateNoExperienceDropped`).
- New helper `scrubInventedMetrics(optimizedContent, sourceContent, verifiedFacts)`:
  1. Iterate output bullets.
  2. Extract numeric tokens via existing `QUANTIFIED_BULLET_REGEX` (`resume-tailoring.constants.ts:46`).
  3. For each token, require it to appear in (a) the matched source bullet OR (b) any `verifiedFacts.userResponse`.
  4. On mismatch: log a `hallucinated_metric` event, replace the bullet with the source bullet (preserving rewriting elsewhere is risky — fall back wholesale for that bullet).
- Add metric `hallucination_rate` to dashboard.

**Validation:** Run on golden set; assert `hallucination_rate < 1%`.

### P1.5 — Cover-letter cache-key bug

- File: `cover-letter-generation.service.ts:123-131`.
- Include `verifiedFacts` hash (stable canonical JSON) in the cache key. Otherwise two users with the same job/keywords/name receive identical letters.

**Validation:** Manual check — two distinct verified-facts produce distinct cache keys.

### P1.6 — `achievements` field conflict

- File: `resume-optimizer.service.ts:150` (input blanks `achievements: []`) vs. `prompt.service.ts:298` (schema mandates `achievements: ["string"]`).
- Decision: input may omit; output schema marks `achievements` optional with explicit "do not invent" rule. Update both files.

**Validation:** Golden set entries with no source achievements never produce invented ones.

## 6. Phase 2 — 2026 quality lift (Week 3–4, ~5 days)

Single biggest impact-on-output band. Run goldens after every item.

### P2.1 — Few-shot examples

- Files: `prompt.service.ts:207-338, 344-494, 549-586, 592-667`.
- Add 2–3 worked examples per generation prompt, wrapped in `<example>` XML tags. Required cases:
  - Strong-quantified-fact case
  - Vague-answer case (user gave "about 30%" — show how to handle)
  - No-metric-available case (qualitative scope/named-entity fallback)
- Examples live in dedicated constants files (`prompts/examples/optimizer.examples.ts`, etc.) to keep `prompt.service.ts` readable and to allow A/B variants.

### P2.2 — XML restructuring

- Replace `**HEADER:**` markdown blocks in generation prompts with XML tags:
  - `<candidate_resume>`, `<job_signals>`, `<verified_facts>`, `<bullet_rubric>`, `<verb_tiers>`, `<banned_phrases>`, `<failure_modes>`, `<output_schema>`
- Drop `JSON.stringify(x, null, 2)` (`prompt.service.ts:634`) — pretty-printing wastes ~25% tokens.

### P2.3 — Calibrated personas

- Replace generic "expert specialist" lines (`prompt.service.ts:217, 366, 516, 566, 621`) with calibrated personas that encode credentials, target audience, voice. Example sketch for optimizer:
  > Senior resume strategist (12+ yrs) coaching mid-to-senior engineers (L4–L7) into FAANG, late-stage startups, and Fortune 500. Writes for 6-second skim. Past-tense, action-led, every metric defensible in interview. Never uses filler phrases.
- Move the persona line into the `system` block (Phase 1.2 dependency).

### P2.4 — Reasoning scaffold

- Files: optimization (`prompt.service.ts:207-338, 344-494`), cover letter (`592-667`).
- Add a `<thinking>` step before output emission:
  1. List user-verified fact (or "none") matched per bullet.
  2. Verify no metric in draft escapes the source/fact set.
  3. Verify bullet-count parity per experience.
  4. Scan for banned phrases.
- For tool-use mode (P1.3), the reasoning block lives inside the message content; the model is instructed that only the tool input is the final output.

### P2.5 — Verb taxonomy + banned-phrase denylist

- New constants block `<verb_tiers>` (with seniority anchors) and `<banned_phrases>`.
- Banned (initial set): _passionate, results-driven, team player, hard-working, detail-oriented, go-getter, synergy, leverage (as verb), proven track record, dynamic_.
- Verb tiers initial draft per L3/L4/L5/L6/L7 anchors; iterate with eval data.

### P2.6 — Per-bullet rubric

- Add `<bullet_rubric>` requiring each rewritten bullet to score on:
  1. Action verb in tier-appropriate range
  2. Has scope OR outcome (or both)
  3. Mirrors at least one JD keyword if truthful
  4. ≤22 words
  5. Zero banned phrases
  6. Every number traces to source/facts
- Model self-revises any bullet failing a criterion before emit.

### P2.7 — Failure-mode block

- New `<failure_modes>` section per generation prompt covering:
  - Missing `startDate` → empty string + `metadata.warnings` entry, never invent.
  - Vague JD → `confidenceScore ≤ 40`, fall back to job-title keywords.
  - User fact contradicts source bullet → use user fact, log to `metadata.contradictions`.
  - Truncated input → flag, do not silently complete.

### P2.8 — Summary pattern + example

- Replace negative-only summary instructions (`prompt.service.ts:289`-style blocks) with positive `<summary_pattern>` template + a worked `<summary_example>` (see audit roadmap).

## 7. Phase 3 — Domain polish (Week 5, ~3 days)

### P3.1 — Consolidate optimization prompts

- Merge `getResumeOptimizationPrompt` and `getPrecisionOptimizationPrompt` (`prompt.service.ts:207-494`) into one fn with optional `verifiedFacts` parameter.
- Drift already visible in ZERO HALLUCINATION wording (lines 219-224 vs 368-374); fixing now prevents further divergence.

### P3.2 — JD keyword priority taxonomy

- File: `prompt.service.ts:110-201`.
- Add explicit taxonomy:
  - Primary = appears in title OR `requirements` section header OR ≥3× in body.
  - Secondary = 1–2× in body OR only in `preferred` section.
  - Synonyms = group canonical forms (`K8s ↔ Kubernetes`).
  - Cap primary at 8 (precision over recall).

### P3.3 — JD analysis system/user split + strict schema

- File: `prompt.service.ts:110-201`, caller `job-analysis.service.ts:88-94`.
- Split static instructions/schema → `system`; variable `position`, `company`, raw JD → `user`.
- Switch `response_format` to `json_schema strict` with a `JobAnalysisJsonSchema`.
- Remove manual `validateAnalysisResult` (`job-analysis.service.ts:194-256`) — the schema enforces it.

### P3.4 — Profile-question strict schema

- File: `prompt.service.ts:500-539`, caller `profile-question-generation.service.ts:131-137`.
- `json_object` → `json_schema strict`.
- Add `enum: ['metrics', 'impact', 'scope', 'technology', 'outcome']` on `questionCategory`.
- Remove silent coercion at the caller.

### P3.5 — Cover-letter hooks + tone calibration

- File: `prompt.service.ts:592-667`.
- Add `<hook_patterns>` (outcome / origin / insight) and `<tone_calibration>` (FAANG terse, enterprise formal, seed direct) plus an explicit anti-pattern denylist for openers.

### P3.6 — No-metric fallback library

- Add `<no_metric_fallbacks>` block: scope ("across 4 teams"), named-entity ("Series-A fintech, 200k MAU"), comparative ("first in org to ship X"). Used when source bullet lacks numbers and no verified fact applies.

### P3.7 — Tense + pronoun rules

- Resume: past-tense for past roles; current role mixes (responsibilities present, achievements past); no first-person pronouns.
- Cover letter: first-person OK; no "I am writing to express my interest"-class openers.

### P3.8 — Re-evaluate extraction vs analysis model choice

- Run goldens with `gpt-4o` and `gpt-4o-mini` swapped between extraction (`ai-content.service.ts:27`) and analysis (`job-analysis.service.ts:89`).
- Likely current assignment is backwards (extraction is mechanical, analysis is nuanced). Decide based on quality + cost data, not assumption.

## 8. Phase 4 — Strategic platform (optional, Week 6+)

Only after Phases 0–3 are stable and measured.

| Item | Trigger | Effort |
|------|---------|--------|
| **Extended thinking on Claude optimizer** (`thinking: { budget_tokens: 4000 }`, feature-flagged + A/B) | Quality bar still below SOTA | 1d |
| **Plan-then-execute scaffold** for precision optimizer (phase 1: `<plan>` mapping facts→bullets; phase 2: emit JSON) | If P2.4 reasoning scaffold insufficient | 1.5d |
| **Multi-step decomposition** (planner → executor → verifier as separate calls; premium-tier only) | Cost vs. quality A/B justifies | 2d |
| **Constitutional rubric** (5–7 line "constitution" model self-critiques against) | After P2.6 rubric proven | 0.5d |
| **A/B harness** (`PromptVariantResolver` keyed on `userId`, config-driven) | Before further prompt edits stack up | 2d |
| **Industry style packs** (tech / consulting / finance / healthcare voice variants) | Eval suite robust enough to measure | 2d |
| **Re-evaluate haiku-4-5 for enrichment** (golden-set vs. sonnet-4) | Enrichment quality complaints | 0.5d |

## 9. Anti-patterns retired (already covered above; listed for closeout review)

- Persona inside user message → `system` (P1.2 + P2.3)
- `json_object` → `json_schema strict` (P1.1, P3.3, P3.4)
- Regex JSON extraction → tool-use (P1.3)
- `JSON.stringify(x, null, 2)` pretty-print → drop (P2.2)
- Hard-coded model strings → constants (F2)
- Two near-identical optimization prompts → merged (P3.1)
- Generic "expert" personas → calibrated (P2.3)
- Negative-only constraints with no positive example → patterns + examples (P2.1, P2.8)
- Undocumented temperatures → named consts per prompt id (F2)
- Cover-letter cache-key omits verified facts → fixed (P1.5)
- `achievements` input/output mismatch → fixed (P1.6)

## 10. Sequencing & risk gates

| Phase | Days | Ship gate before next phase |
|-------|------|-----------------------------|
| 0 | 2 | Versioning live, observability emitting, golden set runs in CI |
| 1 | 3 | Cost cut ≥40% on optimizer step; parse failure <0.5%; verifier active |
| 2 | 5 | Golden-set quality scorecard moves from B- to ≥B+; no regression on cost |
| 3 | 3 | Quality A−/A; cover letter on-par with Teal benchmark; ATS keyword precision improved |
| 4 | optional | Trigger only if KPI gaps remain |

After each phase, **pause** to:
1. Run goldens.
2. Read 48h of telemetry (cost, parse, hallucination KPIs).
3. Decide go/no-go on next phase.

## 11. File-touch summary

| File | Phases touched |
|------|----------------|
| `src/shared/services/prompt.service.ts` | F1, P1.2, P2.*, P3.1–P3.7 |
| `src/shared/services/ai-content.service.ts` | F2, P3.8 |
| `src/modules/resume-tailoring/services/job-analysis.service.ts` | F2, P3.3 |
| `src/modules/resume-tailoring/services/resume-optimizer.service.ts` | F1, F2, P1.1, P1.2, P1.3, P1.4, P1.6 |
| `src/modules/resume-tailoring/services/profile-question-generation.service.ts` | F2, P3.4 |
| `src/modules/resume-tailoring/services/resume-profile-enrichment.service.ts` | F1, F2, P1.2, P1.3 |
| `src/modules/resume-tailoring/services/cover-letter-generation.service.ts` | F1, F2, P1.2, P1.3, P1.5, P3.5 |
| `src/modules/resume-tailoring/constants/resume-tailoring.constants.ts` | F2, P2.5 |
| `src/modules/resume-tailoring/types/*.json-schema.ts` | P1.1, P1.3, P3.3, P3.4 (new schemas) |
| `src/modules/resume-tailoring/prompts/examples/*.ts` | P2.1 (new dir) |
| Database migration | F1 (`prompt_version` column) |
| `test/prompts/golden/*` | F4 (new) |

## 12. Out of scope

- Vector retrieval / RAG over a fact corpus (not warranted for current pipeline scale).
- Fine-tuning custom models (cost vs. lift unfavorable until eval suite is robust).
- Automated prompt-search (DSPy / TextGrad) — revisit after Phase 4.

## 13. Open questions

1. Owner / accountability for prompt versions (Backend? AI Lead?).
2. Storage of golden-set ground truth — committed JSON vs. fixture DB?
3. Premium-only gating for Phase 4 multi-step decomposition (cost-controlled rollout).
4. Should `gpt-5-class` (when available) replace `gpt-4o-2024-11-20` fallback once GA?
5. Industry-pack roadmap (Phase 4) — start with tech only, or build the abstraction first?

## 14. References

- [03-resume-tailoring.md](./03-resume-tailoring.md) — pipeline spec
- [04-profile-enrichment.md](./04-profile-enrichment.md) — Q&A enrichment
- Audit transcripts (Backend Architect agent runs `a2f34fbd13916d853` and `a226dbd2a5ceaa51d`) — full structural + 2026-quality findings backing each item above.
