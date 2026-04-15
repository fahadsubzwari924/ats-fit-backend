# Resume Diff Raw-Before Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the resume diff "before" baseline to show the user's raw uploaded resume instead of the AI-enriched profile content.

**Architecture:** Add `rawContent` field to `ResumeContentResult` interface; populate it in all three return paths of `ResumeContentProcessorService` (always the pre-enrichment content); pass `rawContent` instead of `content` as `originalContent` to the diff job in the orchestrator. Optimizer and cover letter generation are untouched.

**Tech Stack:** TypeScript, NestJS, TypeORM, Bull queues, Jest

---

## File Map

| Action | File | What changes |
|--------|------|-------------|
| Modify | `src/modules/resume-tailoring/interfaces/user-context.interface.ts` | Add `rawContent` field to `ResumeContentResult` |
| Modify | `src/modules/resume-tailoring/services/resume-content-processor.service.ts` | Populate `rawContent` in all return paths |
| Modify | `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts` | Pass `rawContent` instead of `content` to diff job |
| Modify/Create | `src/modules/resume-tailoring/services/resume-content-processor.service.spec.ts` | Unit tests for rawContent population |
| Modify/Create | `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.spec.ts` | Integration test for diff job arg |

---

### Task 1: Add `rawContent` to `ResumeContentResult` interface

**Agent:** `engineering-backend-architect`

**Files:**
- Modify: `src/modules/resume-tailoring/interfaces/user-context.interface.ts`

- [ ] **Step 1: Add the `rawContent` field**

Open `src/modules/resume-tailoring/interfaces/user-context.interface.ts` and update `ResumeContentResult`:

```typescript
export interface ResumeContentResult {
  content: any; // TailoredContent - keeping as any for now due to existing dependencies
  /**
   * Raw extracted resume content — never enriched or optimized.
   * Always reflects what the user originally submitted.
   * Used as the diff "before" baseline.
   */
  rawContent: any;
  source: ContentSource;
  originalText: string;
  /** v4: quality mode when using enriched profile */
  tailoringMode?: TailoringModeResult;
  /** Answered profile questions with non-empty userResponse (for precision optimization) */
  verifiedFacts?: VerifiedFact[];
  metadata: {
    extractionMethod: string;
    processingTime?: number;
    confidenceScore?: number;
    extractedSections?: string[];
    fileSize?: number;
    resumeId?: string;
  };
}
```

- [ ] **Step 2: Build to verify compiler surfaces missing sites**

```bash
npm run build 2>&1 | head -50
```

Expected: TypeScript errors listing every `ResumeContentResult` construction site missing `rawContent` — all should be in `resume-content-processor.service.ts` only. Confirm no unexpected files appear.

---

### Task 2: Populate `rawContent` in `ResumeContentProcessorService`

**Agent:** `engineering-backend-architect`

**Files:**
- Modify: `src/modules/resume-tailoring/services/resume-content-processor.service.ts`

- [ ] **Step 1: Fix `processFromFileUpload` return (~line 158)**

```typescript
return {
  content: structuredContent,
  rawContent: structuredContent,   // same — no enrichment in file upload path
  source: 'file_upload',
  originalText: resumeText,
  tailoringMode: 'standard',
  metadata: {
    extractionMethod: 'ai_extraction_from_file',
    processingTime: processingTime,
    fileSize: resumeFile.size,
  },
};
```

- [ ] **Step 2: Fix `processFromDatabase` — enriched profile path (~line 221)**

Inside the `if (enrichedProfile?.enrichedContent)` block:

```typescript
return {
  content: enrichedProfile.enrichedContent,
  rawContent: enrichedProfile.originalContent,   // raw resume before enrichment
  source: 'database_existing',
  originalText: selectionResult.extractedText,
  tailoringMode: profileCtx.tailoringMode,
  verifiedFacts: profileCtx.verifiedFacts,
  metadata: {
    extractionMethod: 'database_enriched_profile',
    processingTime,
    resumeId: extractedResumeContentId,
  },
};
```

- [ ] **Step 3: Fix `processFromDatabase` — structured content path (~line 242)**

Inside the `if (selectionResult.structuredContent)` block:

```typescript
return {
  content: selectionResult.structuredContent as TailoredContent,
  rawContent: selectionResult.structuredContent,   // same — no enrichment
  source: 'database_existing',
  originalText: selectionResult.extractedText,
  tailoringMode: profileCtx.tailoringMode,
  verifiedFacts: profileCtx.verifiedFacts,
  metadata: {
    extractionMethod: 'database_existing_structured',
    processingTime: processingTime,
    resumeId: selectionResult.resumeId,
  },
};
```

- [ ] **Step 4: Fix `processFromDatabase` — AI re-extraction fallback (~line 269)**

```typescript
return {
  content: structuredContent,
  rawContent: structuredContent,   // same — no enrichment
  source: 'database_extraction',
  originalText: selectionResult.extractedText,
  tailoringMode: profileCtx.tailoringMode,
  verifiedFacts: profileCtx.verifiedFacts,
  metadata: {
    extractionMethod: 'ai_extraction_from_database',
    processingTime: processingTime,
    resumeId: selectionResult.resumeId,
  },
};
```

- [ ] **Step 5: Build to confirm zero errors**

```bash
npm run build 2>&1 | head -30
```

Expected: Zero TypeScript errors.

---

### Task 3: Unit tests for `ResumeContentProcessorService`

**Agent:** `testing-api-tester`

**Files:**
- Modify/Create: `src/modules/resume-tailoring/services/resume-content-processor.service.spec.ts`

- [ ] **Step 1: Write failing tests for all return paths**

```typescript
describe('ResumeContentProcessorService — rawContent', () => {
  it('file upload path: rawContent equals content', async () => {
    const structuredContent = { summary: 'extracted', experience: [] };
    jest
      .spyOn(aiContentService, 'extractResumeContent')
      .mockResolvedValue(structuredContent as any);

    const result = await service.processResumeContent(
      { userId: 'u1', userType: 'premium' },
      mockPdfFile,
    );

    expect(result.rawContent).toEqual(result.content);
    expect(result.rawContent).toEqual(structuredContent);
  });

  it('enriched profile path: rawContent is originalContent, content is enrichedContent', async () => {
    const originalContent = { summary: 'original', experience: [] };
    const enrichedContent = { summary: 'enriched', experience: [] };

    jest
      .spyOn(resumeProfileEnrichmentService, 'getProfile')
      .mockResolvedValue({ originalContent, enrichedContent } as any);

    jest
      .spyOn(resumeSelectionService, 'selectResume')
      .mockResolvedValue({
        resumeId: 'r1',
        extractedText: 'text',
        structuredContent: originalContent,
      } as any);

    jest
      .spyOn(resumeProfileEnrichmentService, 'resolveTailoringContextForResume')
      .mockResolvedValue({ tailoringMode: 'enhanced', verifiedFacts: [] } as any);

    const result = await service.processResumeContent(
      { userId: 'u1', userType: 'premium' },
    );

    expect(result.rawContent).toEqual(originalContent);
    expect(result.content).toEqual(enrichedContent);
    expect(result.rawContent).not.toEqual(result.content);
  });

  it('structured content path (no enriched profile): rawContent equals content', async () => {
    const structuredContent = { summary: 'structured', experience: [] };

    jest
      .spyOn(resumeProfileEnrichmentService, 'getProfile')
      .mockResolvedValue(null);

    jest
      .spyOn(resumeSelectionService, 'selectResume')
      .mockResolvedValue({
        resumeId: 'r1',
        extractedText: 'text',
        structuredContent,
      } as any);

    jest
      .spyOn(resumeProfileEnrichmentService, 'resolveTailoringContextForResume')
      .mockResolvedValue({ tailoringMode: 'standard', verifiedFacts: [] } as any);

    const result = await service.processResumeContent(
      { userId: 'u1', userType: 'premium' },
    );

    expect(result.rawContent).toEqual(result.content);
    expect(result.rawContent).toEqual(structuredContent);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail before Task 2 changes, pass after**

```bash
npm run test -- --testPathPattern="resume-content-processor.service.spec" --verbose 2>&1 | tail -30
```

Expected after Task 2 is done: All three tests PASS.

---

### Task 4: Fix orchestrator + integration test

**Agent:** `engineering-backend-architect`

**Files:**
- Modify: `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts`
- Modify/Create: `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.spec.ts`

- [ ] **Step 1: Write failing integration test**

```typescript
it('passes rawContent (not enriched content) as originalContent to diff job', async () => {
  const rawResume = { summary: 'raw summary', experience: [] };
  const enrichedResume = { summary: 'enriched summary', experience: [] };

  jest
    .spyOn(resumeContentProcessorService, 'processResumeContent')
    .mockResolvedValue({
      content: enrichedResume,
      rawContent: rawResume,
      source: 'database_existing',
      originalText: 'raw text',
      tailoringMode: 'enhanced',
      metadata: { extractionMethod: 'database_enriched_profile' },
    } as any);

  // trigger orchestrator.generateTailoredResume(...)

  expect(resumeQueueService.addChangesDiffJob).toHaveBeenCalledWith(
    expect.objectContaining({
      originalContent: rawResume,
    }),
  );
});
```

- [ ] **Step 2: Run test — confirm it fails**

```bash
npm run test -- --testPathPattern="resume-generation-orchestrator.service.spec" --verbose 2>&1 | tail -30
```

Expected: FAIL — `originalContent` currently receives `enrichedResume`.

- [ ] **Step 3: Fix the orchestrator — swap `.content` to `.rawContent` for diff job**

In `resume-generation-orchestrator.service.ts`, find `addChangesDiffJob` call (~line 200). Change only `originalContent`:

```typescript
void this.resumeQueueService
  .addChangesDiffJob({
    resumeGenerationId: savedGeneration.id,
    userId: input.userContext.userId || '',
    originalContent: resumeContent.rawContent as unknown as Record<  // ← was .content
      string,
      unknown
    >,
    optimizedContent:
      optimizationResult.optimizedContent as unknown as Record<
        string,
        unknown
      >,
    jobAnalysisKeywords: {
      mandatorySkills: jobAnalysis.technical.mandatorySkills,
      primaryKeywords: jobAnalysis.keywords.primary,
    },
  })
```

Leave `candidate_content` on line ~186 unchanged — stays `resumeContent.content` (enriched, feeds cover letter).

- [ ] **Step 4: Run integration test — confirm it passes**

```bash
npm run test -- --testPathPattern="resume-generation-orchestrator.service.spec" --verbose 2>&1 | tail -30
```

Expected: PASS.

---

### Task 5: Full verification

**Agent:** `testing-api-tester`

- [ ] **Step 1: Run full test suite**

```bash
npm run test 2>&1 | tail -20
```

Expected: All tests pass, zero regressions.

- [ ] **Step 2: Lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: Zero errors.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | head -30
```

Expected: Zero errors.

- [ ] **Step 4: Verify candidate_content unchanged**

Grep to confirm `candidate_content` still uses `.content` not `.rawContent`:

```bash
grep -n "candidate_content" src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts
```

Expected output includes `resumeContent.content` (not `rawContent`) on the `candidate_content` line.

---

## Verification Checklist

- [ ] `npm run build` — zero errors
- [ ] `npm run test` — zero failures
- [ ] `npm run lint` — zero errors
- [ ] Enriched profile path: `rawContent !== content` (different objects)
- [ ] File upload path: `rawContent === content` (same content)
- [ ] `candidate_content` saved to DB uses `resumeContent.content` (enriched) — cover letter unaffected
- [ ] `addChangesDiffJob.originalContent` uses `resumeContent.rawContent`
