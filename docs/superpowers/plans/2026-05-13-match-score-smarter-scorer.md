# Smarter Match Score (3-Layer Scorer) Implementation Plan

> **For agentic workers:** every task in this plan MUST be dispatched via `Agent()` with the `subagent_type` from its `agency` field. Never execute inline. No tests required (user opted out). No commits per task (user commits at end).

**Goal:** Replace the literal substring-overlap match scorer with a 3-layer scorer (token-overlap with partial credit + LLM-generated alias expansion on both sides + tiny universal-alias safety net) so genuine candidate↔JD matches score honestly (target ~85% for Muhammad Saeed↔Rewaa, currently 45%).

**Architecture:**
- **Layer 1 (Tokenization):** Normalize + lemmatize + per-phrase token overlap with partial credit and bigram bonus. Replaces literal `text.includes(keyword)`.
- **Layer 2 (Alias expansion):** JD analysis already emits `keywords.synonyms` (currently ignored by scorer). Extend it + add candidate-side `skills` aliases at extraction time. Both sets expand the search space deterministically.
- **Layer 3 (Universal safety net):** Tiny hardcoded map (~15 entries) of universal abbreviations only (k8s↔kubernetes, ci/cd↔continuous integration, etc.). Last resort for cases LLM aliases miss.

**Tech Stack:** Existing NestJS + TypeScript. No new npm deps for stemming — inline ~50-line Porter stemmer subset. No new infra. No embeddings (deferred to a future Layer 4 if measurements warrant).

---

## Backwards compatibility

Old `resume_generations` records (pre-fix) have `keywords.synonyms` in legacy shape and no resume-side aliases. The new scorer must **degrade gracefully**: if aliases are missing, fall back to Layer 1 (tokenization) only. No data migration needed. Bump `OPTIMIZATION_PROMPT_VERSION` to `v2.2` to invalidate the 24h optimization cache and force new JD analyses to include richer aliases.

---

## File map

| File | Purpose |
|---|---|
| `src/modules/resume-tailoring/services/keyword-match-scoring.service.ts` (NEW) | The 3-layer scorer. Single public method `computeScore(content, keywords, jdAliases, resumeAliases): number`. |
| `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts` | Replace inline `computeKeywordMatchScore` calls with new service. Plumb alias data. |
| `src/modules/resume-tailoring/services/job-analysis.service.ts` | Stronger alias generation in LLM prompt + normalize legacy shapes when reading back. |
| `src/shared/services/prompt.service.ts` | Update JD analysis prompts (both cached + non-cached) to ask for more aliases per primary/mandatory keyword. Update resume extraction prompts to emit skill aliases. |
| `src/modules/resume-tailoring/interfaces/job-analysis-result.interface.ts` (if it exists) or wherever `JobAnalysisResult` lives | Add `keywords.aliases?: Array<{term, alternatives}>` (canonical shape). |
| `src/modules/resume-tailoring/interfaces/resume-extracted-keywords.interface.ts` | Add optional `Skills` aliases shape. |
| `src/modules/resume-tailoring/services/resume-content-processor.service.ts` | Plumb through new skill aliases from LLM response into the content object. |
| `src/modules/resume-tailoring/resume-tailoring.module.ts` | Register `KeywordMatchScoringService`. |
| `src/shared/constants/prompt-versions.constants.ts` | Bump `OPTIMIZATION_PROMPT_VERSION` to `v2.2`. Bump JD analysis version if separate constant exists. |
| `docs/ARCHITECTURE.md` | Document the new scorer. |

---

## Task 1 — Build the 3-layer scorer service + wire into orchestrator

**path:**
- `src/modules/resume-tailoring/services/keyword-match-scoring.service.ts` (CREATE)
- `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts` (MODIFY: replace `contentToText` + `computeKeywordMatchScore` private methods with calls to new service; remove dead code; keep `MATCH_SCORE_MAX_PERCENTAGE` cap)
- `src/modules/resume-tailoring/resume-tailoring.module.ts` (MODIFY: register `KeywordMatchScoringService` as provider)
- `src/shared/constants/prompt-versions.constants.ts` (MODIFY: bump `OPTIMIZATION_PROMPT_VERSION` to `'v2.2'`)
- `docs/ARCHITECTURE.md` (MODIFY: add a `### Match scoring (smarter scorer)` subsection under the resume tailoring pipeline)

**intent:** Replace pure substring overlap with token-overlap + partial credit + alias expansion + tiny safety net. Must handle missing aliases gracefully (fall back to Layer 1 only). Same public contract as current scorer: takes content + keyword set, returns integer 0-95.

**Implementation details:**

```ts
// KeywordMatchScoringService public API
computeScore(
  content: TailoredContent | string,  // structured (for after) OR raw text (for before)
  keywordSet: { term: string; aliases?: string[] }[],
  candidateSkillAliases?: Array<{ skill: string; aliases: string[] }>,
): { score: number; perKeyword: Array<{ keyword: string; matchedTokens: number; totalTokens: number; via: 'literal'|'alias'|'token-partial'|'safety-net' }> }
```

Algorithm per keyword phrase:
1. Build `candidate_phrases = [keyword.term, ...keyword.aliases ?? [], ...UNIVERSAL_ALIAS_MAP[keyword.term.toLowerCase()] ?? []]`
2. Build `resume_text` by `flattenContentToText(content)` (move existing helper into new service), expanded with all `candidateSkillAliases[*].aliases` joined.
3. For each candidate phrase:
   - Normalize: lowercase, strip non-alphanumeric except `+` `#` `.`, collapse hyphens to spaces, lemmatize each word via inline Porter-lite stemmer (handles `optimization↔optimize`, `leadership↔lead`, `architectures↔architect`, etc.)
   - Tokenize on whitespace
   - For each token: check word-boundary presence in normalized resume_text → bool
   - `phrase_score = matched_tokens / total_tokens`
   - Bigram bonus: if any two adjacent phrase tokens appear adjacent in the resume text, add 0.2 (cap at 1.0)
4. `keyword_score = max(phrase_score across candidate_phrases)`
5. Overall: `score = round(avg(keyword_score) * 100)`, capped at `MATCH_SCORE_MAX_PERCENTAGE` (95).

`UNIVERSAL_ALIAS_MAP` (~15 entries, exported const):
```
k8s ↔ kubernetes
ci/cd ↔ continuous integration ↔ continuous delivery ↔ continuous deployment
postgres ↔ postgresql ↔ pg
js ↔ javascript        ts ↔ typescript
rest ↔ restful ↔ rest api ↔ restful api
node ↔ nodejs ↔ node.js
full stack ↔ full-stack ↔ fullstack
front end ↔ front-end ↔ frontend
back end ↔ back-end ↔ backend
aws ↔ amazon web services
gcp ↔ google cloud platform ↔ google cloud
nlp ↔ natural language processing
ml ↔ machine learning
ai ↔ artificial intelligence
db ↔ database
```

**Important:** When `content` is a string (the before-score case currently uses `resumeContent.rawContent` cast to TailoredContent — that's broken, see investigation notes), accept the string directly and use it as the flattened text.

In the orchestrator, transform `jobAnalysis.keywords.primary + jobAnalysis.technical.mandatorySkills` into `keywordSet`, merging in `jobAnalysis.keywords.synonyms` (handle both legacy shapes — `{keyword: [synonyms]}` map AND `[{term, alternatives}]` array) when matching aliases to terms. Pass `null`/`undefined` for `candidateSkillAliases` until Task 3 adds them (graceful degradation).

**verify:**
- `cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run build` → exit 0
- `npm run lint` → exit 0
- Manual sanity: log the scorer output for Muhammad Saeed↔Rewaa generation and confirm score lands in 60-95 band (was 45). This is observable via re-running the tailoring; not required to be automated.

**agency:** `Backend Architect`

**docs:**
- `.ai/CONTRACT.md`
- `docs/ARCHITECTURE.md`
- `docs/CONVENTIONS.md`
- Existing `feedback_dispatch_specialists.md` memory

---

## Task 2 — Strengthen JD-side alias generation in LLM prompt

**path:**
- `src/shared/services/prompt.service.ts` (MODIFY: both `getJobDescriptionAnalysisPrompt` non-cached and `getJobDescriptionAnalysisPromptParts` cached paths — update the `Synonyms` instruction to require aliases for EVERY primary keyword and every mandatory skill, not just abbreviations; provide 5 worked examples in the prompt covering: lead↔leadership variants, architecture↔system architecture↔microservices architecture, performance optimization↔tuning↔gains, full-stack↔fullstack↔full stack development, code reviews↔code review↔code-review)
- `src/modules/resume-tailoring/services/job-analysis.service.ts` (MODIFY: add a `normalizeAliases` helper that accepts either legacy shape `{keyword: [synonyms]}` OR new `[{term, alternatives}]` array and returns the canonical `[{term, alternatives}]` array. Persist the canonical shape. Existing records keep working via Task 1's graceful read.)
- `src/modules/resume-tailoring/interfaces/job-analysis-result.interface.ts` (if exists; otherwise wherever `JobAnalysisResult` type lives — find via grep)

**intent:** Make the LLM emit ≥3 alias variants per primary keyword (currently only emits 0-3 across the entire JD). Aliases should cover morphological variation (lead/leader/leadership), modifier-stripping variants (system architecture↔architecture), and common reorderings. The richer alias set feeds directly into the new scorer from Task 1.

**Concrete prompt change (apply identically to both paths):**
Replace the current `Synonyms` paragraph with:
```
- **Aliases (REQUIRED for EVERY primary keyword and EVERY mandatory skill — minimum 2 alternatives each):**
  For every term in `keywords.primary` and `technical.mandatorySkills`, emit a corresponding entry in `keywords.aliases` capturing common alternative phrasings a candidate might use to describe the same concept. Include:
    - Abbreviations (k8s ↔ kubernetes, ml ↔ machine learning)
    - Morphological variants (lead ↔ leader ↔ leadership ↔ led)
    - Modifier-stripped variants (system architecture ↔ architecture, performance optimization ↔ optimization)
    - Hyphenation variants (full-stack ↔ fullstack ↔ full stack)
    - Re-orderings and common substitutes (code reviews ↔ code review ↔ peer review)
  Examples:
    { "term": "Technical Lead",          "alternatives": ["tech lead", "team lead", "engineering lead", "lead software engineer"] }
    { "term": "Performance Optimization","alternatives": ["performance tuning", "performance improvements", "performance gains", "optimization"] }
    { "term": "System Architecture",     "alternatives": ["software architecture", "microservices architecture", "system design", "architectural design"] }
    { "term": "Full-Stack Development",  "alternatives": ["fullstack development", "full stack engineering", "full-stack engineering"] }
    { "term": "Best Practices & Code Reviews", "alternatives": ["code reviews", "peer review", "engineering best practices", "code quality"] }
```

Rename the output field from `synonyms` to `aliases` for clarity; keep `synonyms` as a deprecated alias for one prompt-version cycle (Task 1 reads both).

**verify:**
- `npm run build && npm run lint` → both exit 0
- Manual: trigger a fresh JD analysis for the Rewaa JD and inspect `job_analysis->'keywords'->'aliases'` — should contain ≥6 keyword entries each with ≥2 alternatives.

**agency:** `Backend Architect`

**docs:**
- `.ai/CONTRACT.md`
- `docs/ARCHITECTURE.md`

---

## Task 3 — Resume-side aliases at extraction time

**path:**
- `src/shared/services/prompt.service.ts` (MODIFY: find the resume extraction / structured-parse prompt and add `skillAliases` to its output schema)
- `src/modules/resume-tailoring/services/resume-content-processor.service.ts` (MODIFY: thread the new `skillAliases` from the LLM response into the returned content)
- `src/modules/resume-tailoring/interfaces/resume-extracted-keywords.interface.ts` (MODIFY: add an optional `Skills`-level `aliases?: Array<{ skill: string; alternatives: string[] }>` field on `TailoredContent` or as a sibling)
- `src/modules/resume-tailoring/schemas/resume-tailored-content.schema.ts` (MODIFY: align Zod schema with new optional field)
- `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts` (MODIFY: forward `candidateContent.skillAliases` into the scorer call)
- `src/database/entities/enriched-resume-profile.entity.ts` if applicable (MODIFY: persist aliases on the enriched profile so they survive across tailor-apply runs)

**intent:** At resume parsing time, ask the LLM to also emit ≥2 alternative phrasings per skill (e.g. "Team Leadership" → `["technical leadership", "engineering leadership", "led a team"]`). Persist on the enriched profile so subsequent tailorings reuse without recomputation. The scorer from Task 1 uses these to expand the matchable surface on the candidate side.

**Concrete prompt change:** in the resume extraction prompt's output schema, add:
```json
"skillAliases": [
  { "skill": "string (canonical form from skills.*)", "alternatives": ["string", "..."] }
]
```
Instruction: "For each skill in `skills.languages | frameworks | tools | databases | concepts`, emit at least 2 common alternative phrasings (abbreviations, morphological variants, common substitutes). This expands the matchable surface for downstream scoring without modifying the candidate's actual skill list."

**verify:**
- `npm run build && npm run lint` → both exit 0
- Manual: trigger a fresh resume extraction for Muhammad Saeed and inspect that `skillAliases` contains aliases like `Team Leadership → [technical leadership, engineering leadership, led a team]`.

**agency:** `Backend Architect`

**docs:**
- `.ai/CONTRACT.md`
- `docs/ARCHITECTURE.md`

---

## Verification across all tasks

After all three tasks land:
1. `npm run build` clean
2. `npm run lint` clean
3. Re-tailor Muhammad Saeed's resume against the original Rewaa Technical Lead JD
4. Inspect `match_score_after` in DB — expected band: **75-92%** (was 45%)
5. Inspect a non-matching role (e.g. .NET role) — expected band: **25-40%** (should remain low; aliases shouldn't manufacture matches that don't exist)
6. Inspect `hallucinated_skills` / `hallucinated_tech` logs — should remain unchanged (zero).

If post-fix the .NET role suddenly scores >60%, that means aliases are too aggressive and we have a calibration problem — revisit the alias prompt instructions to be stricter about morphological-only variants.

---

## Out of scope

- OpenAI text-embedding-3-small (Layer 4 from research) — defer until we measure Layers 1-3 in production.
- ESCO/O*NET taxonomy import — overkill for current scale.
- Unit tests — user opted out for this pass; will revisit before broader rollout.
- BM25 hybrid — research shows it dilutes signal for skill matching.
