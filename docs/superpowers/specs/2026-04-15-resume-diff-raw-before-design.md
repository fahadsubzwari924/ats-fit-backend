# Resume Diff: Use Raw Resume as "Before" Baseline

**Date:** 2026-04-15
**Status:** Approved

---

## Problem

The resume tailoring diff (before/after comparison) uses the wrong "before" baseline when a user has an enriched profile.

**Current flow:**
1. `ResumeContentProcessorService.processFromDatabase` → if enriched profile exists, returns `enrichedContent` as `resumeContent.content`
2. Orchestrator passes `resumeContent.content` as `originalContent` to the diff job
3. Diff "before" = enriched content (already upgraded by profile Q&A answers)
4. Diff "after" = AI-optimized content

**Result:** The before/after comparison shows two AI-generated versions. Users cannot see what changed relative to their actual submitted resume.

**Correct "before":** The raw extracted resume — what the user actually uploaded before any AI enrichment or optimization.

---

## Solution

Add `rawContent: TailoredContent` to `ResumeContentResult`. This field always holds the pre-enrichment, pre-optimization resume content. Populate it in all three return paths of `ResumeContentProcessorService`. Pass `rawContent` (not `content`) as `originalContent` to the diff job.

The AI optimizer continues to receive `content` (enriched) — this is correct and must not change.

---

## Data Flow (After Fix)

```
User resume upload / DB lookup
        │
        ▼
ResumeContentProcessorService
        │
        ├── content:    enrichedContent  (→ optimizer → better tailored PDF)
        └── rawContent: originalContent  (→ diff job  → honest "before")

Diff job:
  originalContent = rawContent   ← fixed
  optimizedContent = optimizer output

cover-letter:
  candidateContent = candidate_content (DB) = content (enriched)  ← unchanged
```

---

## Files to Change

### 1. `src/modules/resume-tailoring/interfaces/user-context.interface.ts`

Add to `ResumeContentResult`:
```typescript
/**
 * Raw extracted resume content — never enriched or optimized.
 * Always reflects what the user originally submitted.
 * Used as the diff "before" baseline.
 */
rawContent: TailoredContent;
```

### 2. `src/modules/resume-tailoring/services/resume-content-processor.service.ts`

Three return sites in `processFromDatabase` and `processFromFileUpload`:

| Path | `content` | `rawContent` |
|------|-----------|--------------|
| `processFromFileUpload` | `structuredContent` | `structuredContent` (same — no enrichment step) |
| `processFromDatabase` — enriched profile | `enrichedProfile.enrichedContent` | `enrichedProfile.originalContent` |
| `processFromDatabase` — structured (no enriched profile) | `selectionResult.structuredContent` | `selectionResult.structuredContent` (same) |
| `processFromDatabase` — AI re-extraction fallback | `structuredContent` | `structuredContent` (same) |

### 3. `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts`

Line ~204 in `addChangesDiffJob` call — swap field:

```typescript
// Before (wrong):
originalContent: resumeContent.content as unknown as Record<string, unknown>

// After (correct):
originalContent: resumeContent.rawContent as unknown as Record<string, unknown>
```

`candidate_content` saved to DB (line ~186) stays as `resumeContent.content` (enriched) — this feeds cover letter generation and must not change.

---

## What Does NOT Change

- `ChangesDiffComputationService` — pure function, no changes
- `ChangesDiffProcessor` — no changes
- `candidate_content` DB column — stays enriched (used by cover letter AI)
- Optimizer input — stays enriched (`resumeContent.content`)
- All guest/file-upload paths behave identically (rawContent === content when no enrichment)

---

## Testing

**Unit — `ResumeContentProcessorService`:**
- Enriched profile path: assert `rawContent === enrichedProfile.originalContent`, `content === enrichedProfile.enrichedContent`
- Structured path (no enriched profile): assert `rawContent === content`
- File upload path: assert `rawContent === content`

**Integration — orchestrator:**
- Spy on `resumeQueueService.addChangesDiffJob`; assert `originalContent` equals raw extracted content, not enriched content, when enriched profile exists

---

## Risk

Low. Change is additive (new field). All existing behavior preserved except the diff "before" baseline, which is the intended fix. No DB migration needed.
