# Match Score Unification — Implementation Plan

> **For agentic workers:** every task MUST be dispatched via `Agent()` with the `subagent_type` from its `agency` field. Never execute inline. No unit tests. No commits per task — user commits at the end after review.

**Goal:** Eliminate the dual-scorer inconsistency where match scores differ across UI surfaces (94/94 in live modal vs 0/50 in history modal for the same generation). Land a single canonical `matchScore` block produced by the backend that every UI surface renders directly with zero in-template logic.

**Architecture decisions (locked in this plan):**
1. **One scorer.** `ChangesDiffComputationService.computeKeywordCoverage` delegates to `KeywordMatchScoringService`. `changes_diff.keywordAnalysis.coverage*` and `match_score_*` columns share one engine.
2. **`before` uses the user-uploaded raw text.** Source-side score = literal + tokenization + stemmer only. No aliases on `before`. The "before" is the ATS literal scanner's view.
3. **`after` uses full alias machinery.** Tailored-side score = token-overlap + JD aliases + candidate skillAliases + universal safety net. The "after" is the alias-aware view.
4. **Backend classifies improvement kind.** No FE thresholds. `improvementKind` + `improvementMessage` + `statusColor` are derived once on the BE and broadcast.
5. **One canonical `MatchScoreBlock` shape on every API.** Single tailoring, batch tailoring, history list, history detail — all return the same shape. FE renders directly.

**Out of scope:**
- Backfilling old (`v2.0`, `v2.1`) records — legacy data keeps its stored values forever.
- Unit tests — opted out by user.
- Embedding fallback (Layer 4 from research) — measure first, defer.

---

## Canonical `MatchScoreBlock` interface (the single source of truth)

```ts
interface MatchScoreBlock {
  before: number;                    // 0-95
  after: number;                     // 0-95
  delta: number;                     // after - before
  improvementKind: 'already-strong' | 'improved' | 'low-fit' | 'flat';
  improvementMessage: string;        // ready-to-display text
  statusColor: 'success' | 'warning' | 'muted'; // semantic, FE maps to palette
}
```

Classification rules (in `MatchScoreClassifierService`):
- `after < 40` → `low-fit`, `muted`, "Limited keyword overlap — strengthen relevant experience"
- `before >= 80 && delta < 10` → `already-strong`, `success`, "Already a strong match — minor refinements applied"
- `delta >= 10` → `improved`, `success`, "+{delta}% improvement"
- otherwise → `flat`, `warning`, "Match score: {after}%"

---

## Task A — Backend unification

**path:**
- `src/modules/resume-tailoring/services/keyword-match-scoring.service.ts` (MODIFY: add `options?: { applyAliases?: boolean }` to `computeScore`; when `applyAliases === false` ignore `keywordSet[*].aliases`, ignore `candidateSkillAliases`, and ignore `UNIVERSAL_ALIAS_MAP` — pure literal + tokenization + Porter-lite stemmer only)
- `src/modules/resume-tailoring/services/changes-diff-computation.service.ts` (MODIFY: `computeKeywordCoverage` delegates to `KeywordMatchScoringService.computeScore` — same scorer everywhere; pass `applyAliases: false` for `coverageOriginal` against `originalText`, `applyAliases: true` for `coverageOptimized` against the structured tailored content)
- `src/modules/resume-tailoring/services/match-score-classifier.service.ts` (NEW: `@Injectable()` with a single method `classify(before: number, after: number): MatchScoreBlock`; implements the rules above)
- `src/modules/resume-tailoring/interfaces/match-score-block.interface.ts` (NEW: exports `MatchScoreBlock` interface and the four `improvementKind`/`statusColor` literal types)
- `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts` (MODIFY: change before-score call to use `resumeContent.originalText ?? ''` with `applyAliases: false`; keep after-score using `optimizationResult.optimizedContent` with full aliases; pass `before` + `after` through `classifier.classify()` to build the canonical block; store the block via existing `match_score_before/after` columns and ALSO via a new `match_score_block` JSONB column OR enriched onto `changes_diff` — pick whichever is one-migration-clean — for serialization back to clients)
- `src/modules/resume-tailoring/mappers/tailored-resume-response.mapper.ts` (MODIFY: emit the `MatchScoreBlock` shape in the JSON envelope alongside the existing HTTP headers — single tailoring flow)
- `src/modules/resume-tailoring/models/resume-history.model.ts` (MODIFY: build `matchScore` as the full `MatchScoreBlock` via the classifier; remove the changesDiff fallback branch since the scorer is now unified — keep a single fallback path: if columns are null/missing, return `null` rather than substituting stale coverage values)
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts` (MODIFY: replace flat `matchScoreBefore`/`matchScoreAfter` fields on batch result items with the nested `MatchScoreBlock` field)
- `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.processor.ts` (MODIFY: same as above wherever batch results are shaped)
- `src/modules/resume-tailoring/dtos/batch-generate.dto.ts` (MODIFY: type updates for the new nested shape if a DTO declares the response)
- `src/modules/resume-tailoring/resume-tailoring.module.ts` (MODIFY: register `MatchScoreClassifierService` as a provider)
- `src/shared/constants/prompt-versions.constants.ts` (MODIFY: bump `OPTIMIZATION_PROMPT_VERSION` `v2.2` → `v2.3` so any cached entries get re-scored with the new logic)
- `docs/ARCHITECTURE.md` (MODIFY: under the existing `### Match scoring (smarter scorer)` subsection, append a paragraph describing: (a) `originalText`-based asymmetric scoring, (b) the `MatchScoreBlock` shape as the single output contract, (c) BE-side classification replacing FE thresholds. ~10 lines.)

**intent:**
Unify all match-score computation behind `KeywordMatchScoringService`. The before-score must reflect the user's literal uploaded text (no LLM-touched content, no aliases). The after-score uses the full alias-aware pipeline. Every API endpoint that returns generation data emits the same `MatchScoreBlock` shape with backend-derived `improvementKind` / `improvementMessage` / `statusColor` so the frontend renders without any logic.

**Critical sub-requirements:**
- `before` source: `resumeContent.originalText` (literal PDF text) — fall back to flattened `rawContent` only if `originalText` is missing AND log a warning so we can hunt down legacy paths.
- `before` scoring config: `applyAliases: false`. Pure literal + tokenization + Porter-lite stemming. The universal safety-net map is OFF on the source side too.
- `after` scoring config: unchanged (full aliases as today).
- `MatchScoreClassifierService.classify` is the ONLY place that derives `improvementKind` / `improvementMessage` / `statusColor`. No duplication.
- `resume-history.model.ts` must NOT substitute `changesDiff.keywordAnalysis.coverage*` when columns are null. Return `null` for `matchScore` instead and let the FE handle the missing case gracefully.
- Keep flat `matchScoreBefore`/`matchScoreAfter` fields as DEPRECATED-but-populated mirrors on batch results for ONE prompt-version cycle so legacy FE versions don't break during deploy. Mark with a comment `// TODO: remove after FE migration lands`.

**verify:**
- `cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-backend && npm run build` exits 0
- `npm run lint` exits 0
- Manual: re-tailor Muhammad Saeed's resume against the Rewaa Technical Lead JD. In DB query `match_score_before` should land in 25-45% band (literal scoring on PDF text), `match_score_after` in 75-92% band (alias-expanded). `changes_diff.keywordAnalysis.coverageOriginal` should equal `match_score_before` (single scorer); `coverageOptimized` should equal `match_score_after`.
- Manual: query the response JSON of a single tailoring — it includes a `matchScore` field with `{ before, after, delta, improvementKind, improvementMessage, statusColor }`.
- Manual: query the history endpoint — same `matchScore` shape on each item; legacy v2.1 records that have columns populated show the block, records with null columns show `matchScore: null`.

**agency:** `Backend Architect`

**docs:**
- `.ai/CONTRACT.md`
- `docs/ARCHITECTURE.md`
- `docs/CONVENTIONS.md`
- `docs/API-PATTERNS.md`
- Existing memory `feedback_dispatch_specialists.md`

---

## Task B — Frontend consolidation

**path:**
- `src/app/features/tailor-apply/models/tailored-resume.model.ts` (MODIFY: import shared `MatchScoreBlock` interface; replace local definition with the canonical shape)
- `src/app/features/dashboard/models/resume-history.model.ts` (MODIFY: same import; replace local matchScore shape)
- `src/app/features/tailor-apply/models/batch-tailoring.model.ts` (MODIFY: replace flat `matchScoreBefore`/`matchScoreAfter` fields on `BatchJobResult` with nested `matchScore?: MatchScoreBlock`; keep flat fields temporarily marked DEPRECATED for one release if needed for backwards compat with mid-deploy BE state)
- `src/app/features/tailor-apply/components/step-results/step-results.component.html` (MODIFY: drop the `ms.delta >= 0 ? '+' : ''` template ternary; render `matchScore.improvementMessage` directly; bind status color from `matchScore.statusColor`)
- `src/app/features/dashboard/components/resume-history/resume-history-modal.component.html` (MODIFY: remove the `?? { coverageOriginal, coverageOptimized, ... }` fallback at lines 204-205; render `matchScore.improvementMessage` directly; drop delta arithmetic from the template)
- `src/app/shared/components/resume-history-card/resume-history-card.component.html` (MODIFY: remove the hardcoded color thresholds `>= 70 / >= 50 / else`; bind to `matchScore.statusColor` with a small TS helper that maps `'success' | 'warning' | 'muted'` to the existing palette tokens — keep the helper in the component class, not the template)
- `src/app/features/tailor-apply/components/batch-job-card/batch-job-card.component.html` (MODIFY: switch from flat `matchScoreBefore`/`matchScoreAfter` reads to nested `result.matchScore`; replace the conditional rendering block with a single render that uses `matchScore.improvementMessage`)
- `src/app/features/tailor-apply/components/batch-results/batch-results.component.html` (MODIFY: same as above)
- `src/app/features/tailor-apply/components/resume-comparison/resume-comparison.component.html` (MODIFY: replace `enhancedDiff()!.keywordAnalysis.coverageOriginal/coverageOptimized` reads with `matchScore.before` / `matchScore.after` from the parent data binding — if comparison view doesn't currently have access to `matchScore`, plumb it via the component's input)
- `src/app/features/tailor-apply/components/resume-comparison/resume-comparison.component.ts` (MODIFY: add `matchScore` input if not already present)
- `src/app/shared/types/match-score-block.model.ts` (NEW: exports the shared `MatchScoreBlock` interface mirroring the BE shape — single source of truth on the FE)

**intent:**
Remove every piece of match-score logic from FE templates and component classes. All six UI surfaces render directly from the BE-supplied `matchScore` block: render `improvementMessage` as the headline, bind colors via `statusColor`, and never compute delta, never select between data sources, never apply thresholds. One shared TS interface for the shape, sourced from the backend's canonical interface.

**verify:**
- `cd /Users/fahadsubzwari924/Documents/sideProjects/ATS_FIT/ats-fit-frontend && npm run build` exits 0
- `npm run lint` exits 0
- Visual sanity (manual): all six surfaces show the same score and the same improvement message for the same generation. Use Muhammad Saeed's Rewaa Technical Lead generation to verify.
- Grep check: `grep -rn 'coverageOriginal\|coverageOptimized\|matchScoreBefore\b' src/app | grep -v '.spec.'` should return zero results except in type definitions marked DEPRECATED.

**agency:** `Frontend Developer`

**docs:**
- `.ai/CONTRACT.md` (if exists in FE repo)
- Component conventions doc if FE has one

---

## Cross-task verification (end-to-end)

After both tasks land:
1. BE: `npm run build && npm run lint` both green.
2. FE: `npm run build && npm run lint` both green.
3. Re-tailor Muhammad Saeed against the Rewaa Technical Lead JD.
4. Open the live "Resume Ready" modal → record before/after/improvementMessage.
5. Open the Resume History modal → expand the same generation → record before/after/improvementMessage.
6. Open the dashboard Resume History card → record after%.
7. **All three must show identical numbers and identical improvement messaging.**
8. Repeat for a non-matching role (the user's .NET role test): the before should be low (literal on original text), the after should also stay low (aliases don't manufacture .NET-related matches that don't exist), and the message should classify as `low-fit`.

If any surface diverges, the bug is in Task B's template wiring; if all surfaces agree but the numbers themselves look wrong, the bug is in Task A's scorer config.
