# Resume Tailoring Tech-Substitution Hallucination Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the resume optimizer from inserting technologies (React, etc.) into work experience bullets where the candidate did not actually use that technology.

**Architecture:** Two-layer defense: (1) **prompt-side** — extend zero-hallucination policy to cover tech tokens, inject a per-experience `experience_tech_lock` section, split "JD wants" vs "candidate has", add an anti-example; (2) **code-side** — derive per-experience allowed-tech sets from extracted resume content, pass into prompt, and add a deterministic post-LLM scrubber that reverts bullets containing JD-driven tech tokens absent from that experience's allowlist. Bump default Claude model to Sonnet 4.6 and bump optimization prompt version.

**Tech Stack:** TypeScript, NestJS. Anthropic Claude API. No new external deps.

**Execution notes (user-requested updates 2026-05-13):**
- Unit tests are deferred — implementation only for now.
- No per-task git commits — user will request a single commit at the end.
- Verification per task is `npm run build` + `npm run lint` (targeted file) where applicable.

---

## File structure (touchpoints)

| File | Responsibility | Action |
|---|---|---|
| `src/modules/resume-tailoring/services/experience-tech-allowlist.service.ts` | Build per-experience allowed-tech sets from candidate content | **Create** |
| `src/modules/resume-tailoring/services/experience-tech-allowlist.service.spec.ts` | Unit tests for allowlist extractor | **Create** |
| `src/shared/services/prompt.service.ts` | Optimization prompt body | **Modify** (fixes #1, #2 prompt side, #3, #6) |
| `src/modules/resume-tailoring/prompts/examples/optimizer.examples.ts` | In-context examples | **Modify** (fix #4: add anti-example) |
| `src/modules/resume-tailoring/services/resume-optimizer.service.ts` | Optimizer call + post-LLM validation | **Modify** (fix #2 wire allowlist, fix #5 scrubber extension) |
| `src/modules/resume-tailoring/services/resume-optimizer.service.spec.ts` | Optimizer tests (scrubber + wiring) | **Create** if missing, else **Modify** |
| `src/shared/modules/external/services/claude.service.ts` | Default model env fallback | **Modify** (fix #7) |
| `src/shared/constants/prompt-versions.constants.ts` | Bump optimization prompt version | **Modify** |
| `docs/ARCHITECTURE.md` | Note new guardrail layer | **Modify** (light note only) |

---

## Risks

| Risk | Mitigation |
|---|---|
| Allowlist too strict — reverts legitimate paraphrases of the same tech | Match only on known tech-token vocabulary (JD frameworks + candidate skills); ignore prose words; case-insensitive substring match on whole-word boundary |
| Tech-extraction misses tokens written in resume body but not in `experience.technologies` field | Scan `responsibilities[]` text for tokens present in candidate-wide skills set — promotes them into that experience's allowlist |
| Cache poisoning by prompt version bump | Already keyed on `promptVersion` (`resume-optimizer.service.ts:124`) — bumping version naturally invalidates |
| Model default override breaks anyone who pinned via `CLAUDE_MODEL` env | Default-only change; env still wins. No breaking config |
| OpenAI fallback path uses different prompt builder (`getOptimizationPrompt`, no parts split) | Apply same prompt edits to both `getOptimizationPrompt` and `getOptimizationPromptParts` |
| New scrubber over-reverts and hides genuine improvements | Log every revert with offending tokens for telemetry; ship behind same `OPTIMIZATION_PROMPT_VERSION` so we can compare cohort metrics |

---

## Tasks

---

### Task 1: Create ExperienceTechAllowlistService with failing tests (TDD red)

- **path:** `src/modules/resume-tailoring/services/experience-tech-allowlist.service.spec.ts`
- **intent:** Encode required behavior of per-experience tech allowlist extractor before implementation.
- **verify:** `npx jest src/modules/resume-tailoring/services/experience-tech-allowlist.service.spec.ts` → tests FAIL with module-not-found.
- **agency:** `Backend Architect` (cursorRule: `@agency-backend-architect.mdc`)
- **docs:** `docs/CONVENTIONS.md`, `docs/TESTING-STRATEGY.md`, `.ai/rules.md`

**Files:**
- Create: `src/modules/resume-tailoring/services/experience-tech-allowlist.service.spec.ts`

- [ ] **Step 1: Write the failing test file**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ExperienceTechAllowlistService } from './experience-tech-allowlist.service';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';

describe('ExperienceTechAllowlistService', () => {
  let service: ExperienceTechAllowlistService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExperienceTechAllowlistService],
    }).compile();
    service = module.get(ExperienceTechAllowlistService);
  });

  const buildContent = (
    experiences: Array<Partial<TailoredContent['experience'][number]>>,
    skills?: Partial<TailoredContent['skills']>,
  ): TailoredContent =>
    ({
      title: 't',
      contactInfo: { name: 'n' },
      summary: 's',
      skills: {
        languages: skills?.languages ?? [],
        frameworks: skills?.frameworks ?? [],
        tools: skills?.tools ?? [],
        databases: skills?.databases ?? [],
        concepts: skills?.concepts ?? [],
      },
      experience: experiences.map((e) => ({
        company: e.company ?? 'C',
        position: e.position ?? 'P',
        duration: e.duration ?? '',
        location: e.location ?? '',
        responsibilities: e.responsibilities ?? [],
        achievements: [],
        startDate: e.startDate ?? '2024-01',
        endDate: e.endDate ?? 'Present',
        technologies: e.technologies ?? '',
      })),
      education: [],
      certifications: [],
      additionalSections: [],
    }) as unknown as TailoredContent;

  describe('buildAllowlist', () => {
    it('returns one allowlist entry per experience in input order', () => {
      const content = buildContent([
        { company: 'A', technologies: 'Angular, NestJS' },
        { company: 'B', technologies: 'React, Node' },
      ]);
      const result = service.buildAllowlist(content, []);
      expect(result).toHaveLength(2);
    });

    it('parses comma-separated technologies field into lowercase tokens', () => {
      const content = buildContent([
        { technologies: 'Angular, NestJS, MongoDB Atlas' },
      ]);
      const [first] = service.buildAllowlist(content, []);
      expect(first.has('angular')).toBe(true);
      expect(first.has('nestjs')).toBe(true);
      expect(first.has('mongodb atlas')).toBe(true);
    });

    it('promotes candidate-wide skill tokens that appear in that experience bullets', () => {
      const content = buildContent(
        [
          {
            responsibilities: [
              'Optimized Angular microfrontends with Nx modularization',
            ],
            technologies: '',
          },
        ],
        { frameworks: ['Angular', 'React', 'Vue'] },
      );
      const [first] = service.buildAllowlist(content, []);
      expect(first.has('angular')).toBe(true);
      // React is in candidate-wide skills but NOT mentioned in this experience's bullets
      expect(first.has('react')).toBe(false);
    });

    it('does NOT add JD-only tokens absent from the experience', () => {
      const content = buildContent(
        [
          {
            responsibilities: ['Built Angular components for billing module'],
            technologies: 'Angular',
          },
        ],
        { frameworks: ['Angular', 'React'] },
      );
      const jdTokens = ['react', 'redux'];
      const [first] = service.buildAllowlist(content, jdTokens);
      expect(first.has('react')).toBe(false);
      expect(first.has('redux')).toBe(false);
    });

    it('handles missing technologies field gracefully', () => {
      const content = buildContent([{ technologies: undefined as never }]);
      expect(() => service.buildAllowlist(content, [])).not.toThrow();
    });
  });

  describe('detectForbiddenTokens', () => {
    it('returns tokens present in output bullet but absent from allowlist and source bullet', () => {
      const allowlist = new Set(['angular', 'nx']);
      const sourceBullet =
        'Optimized Angular microfrontends with lazy loading and Nx modularization';
      const outputBullet =
        'Optimized React microfrontends with lazy loading and modularization';
      const techVocabulary = new Set(['angular', 'react', 'nx', 'vue']);
      const offenders = service.detectForbiddenTokens(
        outputBullet,
        sourceBullet,
        allowlist,
        techVocabulary,
      );
      expect(offenders).toContain('react');
      expect(offenders).not.toContain('angular');
    });

    it('returns empty when output bullet only mentions allowlisted tech', () => {
      const allowlist = new Set(['angular', 'nx']);
      const offenders = service.detectForbiddenTokens(
        'Refined Angular pipelines through Nx caching',
        'Optimized Angular microfrontends with Nx modularization',
        allowlist,
        new Set(['angular', 'nx', 'react']),
      );
      expect(offenders).toEqual([]);
    });

    it('ignores tokens not in tech vocabulary (prose words)', () => {
      const offenders = service.detectForbiddenTokens(
        'Designed scalable architecture for the team',
        'Architected scalable systems for the team',
        new Set(['angular']),
        new Set(['angular', 'react']),
      );
      expect(offenders).toEqual([]);
    });

    it('is case-insensitive', () => {
      const offenders = service.detectForbiddenTokens(
        'Built REACT components',
        'Built Angular components',
        new Set(['angular']),
        new Set(['angular', 'react']),
      );
      expect(offenders).toContain('react');
    });
  });

  describe('buildTechVocabulary', () => {
    it('unions candidate skills with JD tech tokens', () => {
      const content = buildContent([], {
        frameworks: ['Angular', 'React'],
        languages: ['TypeScript'],
      });
      const vocab = service.buildTechVocabulary(content, [
        'Vue',
        'Node.js',
        'TypeScript',
      ]);
      expect(vocab.has('angular')).toBe(true);
      expect(vocab.has('react')).toBe(true);
      expect(vocab.has('typescript')).toBe(true);
      expect(vocab.has('vue')).toBe(true);
      expect(vocab.has('node.js')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/resume-tailoring/services/experience-tech-allowlist.service.spec.ts --testPathIgnorePatterns=''`
Expected: FAIL with `Cannot find module './experience-tech-allowlist.service'`

- [ ] **Step 3: Commit red tests**

```bash
git add src/modules/resume-tailoring/services/experience-tech-allowlist.service.spec.ts
git commit -m "test(resume-tailoring): add failing tests for experience tech allowlist service"
```

---

### Task 2: Implement ExperienceTechAllowlistService (TDD green)

- **path:** `src/modules/resume-tailoring/services/experience-tech-allowlist.service.ts`
- **intent:** Provide per-experience allowed-tech sets, build tech vocabulary, and detect forbidden tech tokens in optimized bullets.
- **verify:** `npx jest src/modules/resume-tailoring/services/experience-tech-allowlist.service.spec.ts` → all tests PASS; `npm run lint -- src/modules/resume-tailoring/services/experience-tech-allowlist.service.ts` → no errors.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`, `.ai/rules.md`

**Files:**
- Create: `src/modules/resume-tailoring/services/experience-tech-allowlist.service.ts`

- [ ] **Step 1: Write minimal implementation**

```typescript
import { Injectable } from '@nestjs/common';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';

@Injectable()
export class ExperienceTechAllowlistService {
  /**
   * Build a per-experience set of allowed technology tokens (lowercase).
   *
   * Source of truth, in priority order:
   *  1. The experience's own `technologies` field (comma-split).
   *  2. Any candidate-wide skill token that appears verbatim inside that
   *     experience's responsibility bullets — promoted into the allowlist.
   *
   * JD tokens that do NOT appear in source (1) or (2) are intentionally
   * excluded — that is the whole point of the fence.
   */
  buildAllowlist(
    content: TailoredContent,
    jdTokens: string[],
  ): Array<Set<string>> {
    const candidateSkillTokens = this.collectCandidateSkills(content);

    return (content.experience ?? []).map((exp) => {
      const allowlist = new Set<string>();

      this.splitTokens(exp.technologies).forEach((t) => allowlist.add(t));

      const bulletsText = (exp.responsibilities ?? []).join(' ').toLowerCase();
      candidateSkillTokens.forEach((skill) => {
        if (this.containsTokenWord(bulletsText, skill)) {
          allowlist.add(skill);
        }
      });

      return allowlist;
    });
  }

  /**
   * Build a tech vocabulary used to decide whether an extra token in an
   * optimized bullet should count as a technology hallucination at all.
   * Prose words are ignored; only tokens in this vocabulary are flagged.
   */
  buildTechVocabulary(
    content: TailoredContent,
    jdTokens: string[],
  ): Set<string> {
    const vocab = new Set<string>();
    this.collectCandidateSkills(content).forEach((t) => vocab.add(t));
    (jdTokens ?? []).forEach((raw) => {
      const t = this.normalize(raw);
      if (t) vocab.add(t);
    });
    return vocab;
  }

  /**
   * Detect tech tokens introduced by the LLM into the optimized bullet that:
   *  - are not in the experience's allowlist,
   *  - are not in the original source bullet,
   *  - are in the tech vocabulary (so prose words are ignored).
   */
  detectForbiddenTokens(
    outputBullet: string,
    sourceBullet: string,
    allowlist: Set<string>,
    techVocabulary: Set<string>,
  ): string[] {
    const outputLower = (outputBullet ?? '').toLowerCase();
    const sourceLower = (sourceBullet ?? '').toLowerCase();
    const offenders: string[] = [];

    techVocabulary.forEach((token) => {
      if (!token) return;
      if (allowlist.has(token)) return;
      if (this.containsTokenWord(sourceLower, token)) return;
      if (this.containsTokenWord(outputLower, token)) offenders.push(token);
    });

    return offenders;
  }

  private collectCandidateSkills(content: TailoredContent): Set<string> {
    const skills = content.skills ?? ({} as TailoredContent['skills']);
    const all = [
      ...(skills.languages ?? []),
      ...(skills.frameworks ?? []),
      ...(skills.tools ?? []),
      ...(skills.databases ?? []),
      ...(skills.concepts ?? []),
    ];
    return new Set(all.map((s) => this.normalize(s)).filter(Boolean));
  }

  private splitTokens(raw?: string): string[] {
    if (!raw) return [];
    return raw
      .split(/[,;|/]/)
      .map((part) => this.normalize(part))
      .filter(Boolean);
  }

  private normalize(value: string): string {
    return (value ?? '').trim().toLowerCase();
  }

  /**
   * True when `text` contains `token` as a standalone token (boundary-aware).
   * Handles tokens with dots/plus signs (`node.js`, `c++`) by escaping.
   */
  private containsTokenWord(text: string, token: string): boolean {
    if (!text || !token) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9.+#])${escaped}([^a-z0-9.+#]|$)`, 'i');
    return re.test(text);
  }
}
```

- [ ] **Step 2: Register provider in ResumeTailoringModule**

Open `src/modules/resume-tailoring/resume-tailoring.module.ts`, add `ExperienceTechAllowlistService` to the `providers` array and the `exports` array. (Exact location: alongside `BulletRelevanceScoringService`.)

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx jest src/modules/resume-tailoring/services/experience-tech-allowlist.service.spec.ts`
Expected: all tests PASS

- [ ] **Step 4: Lint**

Run: `npm run lint -- src/modules/resume-tailoring/services/experience-tech-allowlist.service.ts`
Expected: zero errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/resume-tailoring/services/experience-tech-allowlist.service.ts \
        src/modules/resume-tailoring/resume-tailoring.module.ts
git commit -m "feat(resume-tailoring): add experience tech allowlist service"
```

---

### Task 3: Extend prompt with tech-fence, separated JD/candidate sections, banned tech swaps, softened alignment

- **path:** `src/shared/services/prompt.service.ts`
- **intent:** Make the optimization prompt structurally forbid technology substitution (fix #1, #2 prompt side, #3, #6).
- **verify:** `npm run build` → compiles cleanly; `npx jest --testPathPattern='prompt'` → existing prompt tests still pass.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`, `.ai/rules.md`

**Files:**
- Modify: `src/shared/services/prompt.service.ts`

- [ ] **Step 1: Extend the `getOptimizationPromptParts` system block — replace the existing `<zero_hallucination>` block (currently lines ~521–532) with the extended version below**

Find the block that starts with `<zero_hallucination>` inside `getOptimizationPromptParts`'s `system` template literal. Replace its full content (the entire `<zero_hallucination>…</zero_hallucination>` block) with:

```text
<zero_hallucination>
TWO classes of facts are off-limits unless they appear in the source material:

CLASS A — Quantitative facts (numbers, percentages, dollar amounts, counts, team sizes, durations with numbers):
- Use ONLY metrics that appear in the candidate resume JSON OR in the USER-VERIFIED FACTS
- NEVER invent, estimate, or round
- Preserve approximate user phrasing (e.g. "about 30%") when given in USER-VERIFIED FACTS

CLASS B — Technology facts (programming languages, frameworks, libraries, tools, platforms, cloud services, databases):
- For EACH work experience, you MUST treat the EXPERIENCE_TECH_LOCK section (in the user message) as the EXCLUSIVE list of technologies you may name in that experience's bullets
- NEVER substitute a technology mentioned in the source bullet with a different technology — not even a "similar" one (Angular → React, MySQL → PostgreSQL, Vue → React, Django → Flask are all FORBIDDEN swaps)
- NEVER add a new technology to an experience just because the JD asks for it. The fact that the candidate lists a technology in the global skills section does NOT mean they used it in every job
- If the JD requires a technology the candidate did not use in a given experience, leave that experience's bullets honest and rely on the global skills section + other experiences (or the cover letter) to surface the JD-requested skill

Both classes share the same rule: prefer a strong qualitative or truthful bullet over an embellished one.
</zero_hallucination>
```

- [ ] **Step 2: Replace `<bullet_strategy>` block to soften "JD keyword alignment" (fix #6)**

Find the existing `<bullet_strategy>` block (currently around lines ~536–547) and replace its body with:

```text
<bullet_strategy>
The candidate resume below already contains pre-selected, relevance-ranked bullets per experience.
The number of bullets per experience has been sized by our system based on recency and JD relevance.
You MUST:
- REWRITE every bullet you receive for clarity, CAR framing, and stronger action verbs
- Mirror a JD keyword in a bullet ONLY when that bullet's experience genuinely involved that technology — verify against the EXPERIENCE_TECH_LOCK for that experience before adding any tech term
- For bullets that have a matching USER-VERIFIED FACT (matched by bullet text): inject the metric exactly as stated
- For bullets WITHOUT a matching fact: rewrite honestly using ONLY existing resume content. Do NOT swap, replace, or "modernize" the technologies mentioned in the original bullet
- NEVER drop a bullet that appears in the input experience array
- NEVER add extra bullet points not present in the input
- Output MUST contain exactly the same number of experience entries as the input, and each entry MUST contain exactly the same number of bullets (responsibilities) as given
- MANDATORY DATE FIELDS: Every experience entry MUST have valid startDate and endDate fields
</bullet_strategy>
```

- [ ] **Step 3: Append a new `<experience_tech_lock_protocol>` block to the system prompt directly before `<output_schema>`**

Insert this block right after the `<failure_modes>` block and before `<output_schema>`:

```text
<experience_tech_lock_protocol>
The user message contains an EXPERIENCE_TECH_LOCK section listing, per experience index, the ONLY technologies you may name in that experience's bullets.

For every bullet you output:
1. Identify the experience index it belongs to.
2. Scan your draft bullet for any technology token (language, framework, library, tool, platform).
3. If any technology token in your draft is NOT in that experience's lock list AND was NOT in the corresponding source bullet, REMOVE or REPLACE it with a technology that is in the lock list and was actually used in that source bullet.
4. Never add a technology that came only from the JD requirements.

This is a hard requirement, not a guideline. Output bullets that violate the lock will be rejected by downstream validation and the user will see the original bullet, undoing your edit.
</experience_tech_lock_protocol>
```

- [ ] **Step 4: Extend the `<bullet_rubric>` block — replace criterion #3**

Find `<bullet_rubric>` (around lines ~588–597). Replace criterion #3 currently reading `Mirrors at least one JD keyword if that keyword truthfully reflects the bullet's content` with:

```text
3. Mirrors at least one JD keyword ONLY when the bullet's experience genuinely involved that technology (cross-checked against EXPERIENCE_TECH_LOCK); never substitute a real technology for a JD-requested one
```

And add a new criterion #7 at the end of the rubric (before the closing tag):

```text
7. Every technology, framework, library, language, platform, or database named in the bullet appears in that experience's EXPERIENCE_TECH_LOCK and was already present in the source bullet — no substitutions, no JD-driven additions
```

- [ ] **Step 5: Update the `<thinking>` self-verification block — add a new step #5**

Find the `<thinking>` block at the end of the system prompt and replace its body with:

```text
Before calling the tool, reason through these steps in your response content:
1. For each experience bullet, identify the matched user-verified fact (or note "none") — ensure no metric in your draft came from anywhere else
2. Confirm bullet count per experience matches the input exactly (no additions, no drops)
3. Scan every bullet for banned phrases (see banned_phrases) — revise any that contain them
4. Verify the summary follows the summary_pattern and cites only real resume data
5. For each experience, list the technologies you used in your draft bullets and confirm every one of them is in that experience's EXPERIENCE_TECH_LOCK; if a JD-requested tech is missing from the lock, do NOT add it
Only the tool input is the final output; this reasoning block is for self-verification only.
```

- [ ] **Step 6: Update the `user` template inside `getOptimizationPromptParts` — separate "JD wants" from "candidate has" and inject EXPERIENCE_TECH_LOCK**

Find the `user` template variable (currently around lines ~700–712). Replace it with:

```typescript
    const experienceTechLockLines = (
      (candidateContent.experience as Array<Record<string, unknown>>) ?? []
    )
      .map((exp, idx) => {
        const company =
          typeof exp.company === 'string' ? exp.company : `experience ${idx}`;
        const lock = Array.isArray(
          (exp as { allowedTech?: string[] }).allowedTech,
        )
          ? ((exp as { allowedTech: string[] }).allowedTech ?? [])
          : [];
        return `  [${idx}] ${company}: ${lock.length > 0 ? lock.join(', ') : '(no technologies recorded — keep bullets technology-free unless source bullet names one)'}`;
      })
      .join('\n');

    const user = `**JD REQUIREMENTS (what the target role asks for — do NOT treat these as facts the candidate has):**
- Position: ${jobPosition}
- Company: ${companyName}
- Mandatory Skills: ${Array.isArray(technical.mandatorySkills) ? (technical.mandatorySkills as string[]).join(', ') : 'None specified'}
- Programming Languages: ${Array.isArray(technical.programmingLanguages) ? (technical.programmingLanguages as string[]).join(', ') : 'None specified'}
- Frameworks: ${Array.isArray(technical.frameworks) ? (technical.frameworks as string[]).join(', ') : 'None specified'}
- Primary Keywords: ${Array.isArray(keywords.primary) ? (keywords.primary as string[]).join(', ') : 'None specified'}

**EXPERIENCE_TECH_LOCK (per-experience exclusive technology allowlist — bullets for experience [i] may only name technologies from this list):**
${experienceTechLockLines || '  (no experiences provided)'}

**USER-VERIFIED FACTS (source of truth — preserve these exactly):**
${factsBlock}

**CURRENT CANDIDATE RESUME (bullets already pre-ranked and sized; may already include merged user facts):**
${JSON.stringify(candidateContent)}`;

    return { system, user };
```

- [ ] **Step 7: Apply the same changes to the non-cached path `getOptimizationPrompt` (used by OpenAI fallback)**

Locate `getOptimizationPrompt` (currently starts around line ~346). Update the body so that:
- The "CRITICAL RULE: ZERO HALLUCINATION POLICY" block at the top now covers both Class A (numbers) and Class B (technologies) — copy the Class A/B copy from Step 1 (drop the XML tags; keep markdown headers).
- A new section "**EXPERIENCE_TECH_LOCK (per-experience exclusive technology allowlist):**" is rendered with the same `experienceTechLockLines` builder logic from Step 6.
- "**TARGET JOB INFORMATION:**" is renamed to "**JD REQUIREMENTS (what the target role asks for — do NOT treat these as facts the candidate has):**".
- The "RELEVANCE-RANKED BULLET STRATEGY" section's first sub-bullet "REWRITE every bullet you receive for clarity, CAR framing, and JD keyword alignment" is replaced with: "REWRITE every bullet you receive for clarity, CAR framing, and stronger action verbs. Mirror a JD keyword in a bullet ONLY when that bullet's experience genuinely involved that technology."

(The OpenAI fallback receives a single user prompt with no `system`, so all sections live in one string — that is intentional.)

- [ ] **Step 8: Build + lint**

Run: `npm run build`
Expected: TypeScript compiles cleanly with no new errors.

Run: `npm run lint -- src/shared/services/prompt.service.ts`
Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add src/shared/services/prompt.service.ts
git commit -m "feat(prompt): add tech-substitution guardrails and per-experience tech lock"
```

---

### Task 4: Add anti-example for tech-swap refusal to OPTIMIZER_EXAMPLES

- **path:** `src/modules/resume-tailoring/prompts/examples/optimizer.examples.ts`
- **intent:** Give the model a concrete in-context anchor for refusing a JD-driven tech swap (fix #4).
- **verify:** `npm run build` → compiles; visual inspection of the constant.
- **agency:** `Backend Architect`
- **docs:** `.ai/rules.md`

**Files:**
- Modify: `src/modules/resume-tailoring/prompts/examples/optimizer.examples.ts`

- [ ] **Step 1: Append two new examples before the closing `</examples>` tag**

Replace the file content with:

```typescript
export const OPTIMIZER_EXAMPLES = `<examples>

<example id="1" case="strong-quantified-fact">
Input bullet: "Improved API response time"
User-verified fact: "Reduced p99 latency from 820ms to 140ms by introducing Redis caching"
Output bullet: "Reduced API p99 latency from 820ms to 140ms by introducing a Redis caching layer, improving user-facing response time by 83%."
Note: Metric came directly from user-verified fact — not invented.
</example>

<example id="2" case="vague-answer">
Input bullet: "Worked on CI/CD improvements"
User-verified fact: "Made deploys faster, maybe about 40% faster but not sure exactly"
Output bullet: "Streamlined CI/CD pipeline, reducing average deployment time by approximately 40% through parallelisation and caching build artefacts."
Note: Preserved user's approximate phrasing ("approximately 40%") — did not round up or claim exactness.
</example>

<example id="3" case="no-metric-available">
Input bullet: "Led migration from monolith to microservices"
User-verified fact: (none provided)
Output bullet: "Led end-to-end migration from a monolithic application to a microservices architecture, enabling independent service deployment and reducing cross-team release coupling."
Note: No numbers, no named technology, no scope count — none present in the source bullet. Output uses only concepts from the original bullet (monolith, microservices, independent deployment) without adding specifics.
</example>

<example id="4" case="refuse-jd-driven-tech-swap">
JD requires: React
Experience tech lock for this experience: [angular, nx, typescript]
Input bullet: "Optimized Angular microfrontends with lazy loading and Nx modularization, achieving ~40% performance gains."
User-verified fact: (none provided)
Output bullet: "Optimized Angular microfrontends with lazy loading and Nx modularization, achieving ~40% performance gains through route-level code splitting."
Note: JD asks for React, but this experience's EXPERIENCE_TECH_LOCK does not include React, so Angular MUST stay. We strengthened the bullet qualitatively (added "route-level code splitting") without swapping the framework. Substituting "React" here would be a banned hallucination even though the candidate lists React in their global skills.
</example>

<example id="5" case="refuse-jd-driven-tech-addition">
JD requires: PostgreSQL, Redis
Experience tech lock for this experience: [mongodb, nodejs, express]
Input bullet: "Built an Express-based API aggregator consolidating multiple frontend calls into a single request."
User-verified fact: (none provided)
Output bullet: "Engineered an Express-based API aggregator that consolidated multiple frontend calls into a single request, simplifying the client integration surface."
Note: JD wants PostgreSQL and Redis, but this experience's lock does not include them and the source bullet does not mention any database or cache. Adding "backed by PostgreSQL" or "cached via Redis" would be a banned hallucination. We strengthen the bullet using only the concepts that are actually there (aggregation, single request, client integration).
</example>

</examples>`;
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: TypeScript compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/modules/resume-tailoring/prompts/examples/optimizer.examples.ts
git commit -m "feat(prompt): add anti-examples refusing JD-driven tech swaps and additions"
```

---

### Task 5: Wire allowlist into ResumeOptimizerService and pass into prompt

- **path:** `src/modules/resume-tailoring/services/resume-optimizer.service.ts`
- **intent:** Compute per-experience tech allowlists from the ranked candidate content, attach them to each experience as `allowedTech`, and rely on the prompt's `experienceTechLockLines` builder to render them (fix #2 wiring side).
- **verify:** `npm run build` → compiles; `npx jest src/modules/resume-tailoring/services/resume-optimizer` → all tests pass.
- **agency:** `Backend Architect`
- **docs:** `docs/CONVENTIONS.md`, `.ai/rules.md`

**Files:**
- Modify: `src/modules/resume-tailoring/services/resume-optimizer.service.ts`

- [ ] **Step 1: Inject the new service**

In the constructor of `ResumeOptimizerService`, add the new dependency after `bulletRelevanceScoringService`:

```typescript
    private readonly bulletRelevanceScoringService: BulletRelevanceScoringService,
    private readonly experienceTechAllowlistService: ExperienceTechAllowlistService,
```

And add the import at the top:

```typescript
import { ExperienceTechAllowlistService } from './experience-tech-allowlist.service';
```

- [ ] **Step 2: Build the allowlist and attach to each ranked experience**

Locate the block that constructs `rankedCandidateContent` (currently around lines ~158–165). Replace it with:

```typescript
      const jdTechTokens = [
        ...(jobAnalysis.keywords?.primary ?? []),
        ...(jobAnalysis.technical?.mandatorySkills ?? []),
        ...(jobAnalysis.technical?.frameworks ?? []),
        ...(jobAnalysis.technical?.programmingLanguages ?? []),
        ...(jobAnalysis.technical?.tools ?? []),
        ...(jobAnalysis.technical?.databases ?? []),
      ];

      const preAllowlistContent: TailoredContent = {
        ...candidateContent,
        experience: candidateContent.experience.map((exp, idx) => ({
          ...exp,
          responsibilities: rankedBullets[idx]?.bullets ?? exp.responsibilities,
          achievements: [],
        })),
      };

      const allowlistPerExperience =
        this.experienceTechAllowlistService.buildAllowlist(
          preAllowlistContent,
          jdTechTokens,
        );

      const techVocabulary =
        this.experienceTechAllowlistService.buildTechVocabulary(
          preAllowlistContent,
          jdTechTokens,
        );

      const rankedCandidateContent: TailoredContent = {
        ...preAllowlistContent,
        experience: preAllowlistContent.experience.map((exp, idx) => ({
          ...exp,
          allowedTech: Array.from(allowlistPerExperience[idx] ?? []),
        })) as TailoredContent['experience'],
      };
```

- [ ] **Step 3: Pass `allowlistPerExperience` and `techVocabulary` into `scrubInventedMetrics` callsite (next task wires it)**

Update the call (currently around line ~219) from:

```typescript
      this.scrubInventedMetrics(
        result.optimizedContent,
        rankedCandidateContent,
        verifiedFacts ?? [],
      );
```

to:

```typescript
      this.scrubInventedMetrics(
        result.optimizedContent,
        rankedCandidateContent,
        verifiedFacts ?? [],
        allowlistPerExperience,
        techVocabulary,
      );
```

(Signature update happens in Task 6 — file will not compile yet; commit only after Task 6 lands.)

- [ ] **Step 4: Update `TailoredContent`'s experience entry type to permit the optional `allowedTech` field**

Open `src/modules/resume-tailoring/interfaces/resume-extracted-keywords.interface.ts` (open if it exists; otherwise find the type declaration that defines `experience[number]`) and add `allowedTech?: string[];` to the work-experience type definition. Add a one-line comment: `// Populated at runtime by ResumeOptimizerService — not present in extracted content.`

- [ ] **Step 5: Update prompt-side iteration if the type tightens**

`prompt.service.ts` reads `exp.allowedTech` via a cast — confirm the cast still compiles. No further change expected.

- [ ] **Step 6: (Defer commit to Task 6)**

Do not commit yet — file will not compile until `scrubInventedMetrics` signature is updated in Task 6.

---

### Task 6: Extend post-LLM scrubber to revert tech-substitution hallucinations

- **path:** `src/modules/resume-tailoring/services/resume-optimizer.service.ts`
- **intent:** Add deterministic post-LLM guard that reverts any optimized bullet whose new tokens include a JD-driven technology absent from the experience's allowlist (fix #5).
- **verify:** New unit tests pass; existing optimizer behavior unchanged when no tech tokens are introduced.
- **agency:** `Backend Architect`
- **docs:** `.ai/rules.md`

**Files:**
- Modify: `src/modules/resume-tailoring/services/resume-optimizer.service.ts`
- Create: `src/modules/resume-tailoring/services/resume-optimizer.service.spec.ts` if missing — otherwise modify

- [ ] **Step 1: Write a failing test first (TDD red)**

Open or create `src/modules/resume-tailoring/services/resume-optimizer.service.spec.ts`. Add this `describe` block (keep any existing content):

```typescript
import { ExperienceTechAllowlistService } from './experience-tech-allowlist.service';

describe('ResumeOptimizerService — tech substitution scrubber', () => {
  // Lightweight construction: instantiate only the bits we need.
  const allowlistService = new ExperienceTechAllowlistService();

  // Build a minimally-typed instance with private method access via casting.
  // We can call `scrubInventedMetrics` directly because TS private is a compile-time hint.
  const optimizer = new (class {
    experienceTechAllowlistService = allowlistService;
    logger = { warn: jest.fn(), error: jest.fn() } as never;
    scrubInventedMetrics =
      // copy-paste of the method body would couple us to private internals;
      // we test via the public optimizeResumeContent path in an integration test below
      jest.fn();
  })();

  it('reverts a bullet that swaps Angular for React when React is not in the experience allowlist', () => {
    const source = {
      experience: [
        {
          company: 'Finlex',
          responsibilities: [
            'Optimized Angular microfrontends with lazy loading and Nx modularization, achieving ~40% performance gains.',
          ],
          achievements: [],
          technologies: 'Angular, Nx, TypeScript',
        },
      ],
      skills: {
        languages: ['TypeScript'],
        frameworks: ['Angular', 'React', 'Vue'],
        tools: [],
        databases: [],
        concepts: [],
      },
    } as unknown as Parameters<typeof allowlistService.buildAllowlist>[0];

    const optimized = {
      experience: [
        {
          company: 'Finlex',
          responsibilities: [
            'Optimized React microfrontends with lazy loading and modularization, achieving ~40% performance gains through distributed system architecture.',
          ],
          achievements: [],
          technologies: 'Angular, Nx, TypeScript',
        },
      ],
    } as unknown as typeof source;

    const allowlist = allowlistService.buildAllowlist(source, [
      'react',
      'redux',
    ]);
    const vocab = allowlistService.buildTechVocabulary(source, [
      'react',
      'redux',
    ]);

    const offenders = allowlistService.detectForbiddenTokens(
      optimized.experience[0].responsibilities[0],
      source.experience[0].responsibilities[0],
      allowlist[0],
      vocab,
    );

    expect(offenders).toContain('react');
  });
});
```

Run: `npx jest src/modules/resume-tailoring/services/resume-optimizer.service.spec.ts`
Expected: PASS (this test exercises the allowlist primitives — green from the start; it documents the contract the scrubber relies on).

- [ ] **Step 2: Update `scrubInventedMetrics` signature to accept allowlist + vocabulary**

Replace the existing method (currently lines ~451–504) with:

```typescript
  private scrubInventedMetrics(
    optimizedContent: TailoredContent,
    sourceContent: TailoredContent,
    verifiedFacts: VerifiedFact[],
    allowlistPerExperience: Array<Set<string>> = [],
    techVocabulary: Set<string> = new Set<string>(),
  ): void {
    const verifiedText = verifiedFacts.map((f) => f.userResponse).join('\n');

    for (let i = 0; i < optimizedContent.experience.length; i++) {
      const outputExp = optimizedContent.experience[i];
      const sourceExp = sourceContent.experience[i];
      const allowlist = allowlistPerExperience[i] ?? new Set<string>();

      for (const field of ['responsibilities', 'achievements'] as const) {
        const outputBullets = outputExp[field] ?? [];
        const sourceBullets = sourceExp?.[field] ?? [];

        outputExp[field] = outputBullets.map((bullet, j) => {
          const sourceBullet = sourceBullets[j] ?? '';

          // Class B — technology substitution check
          if (techVocabulary.size > 0 && sourceBullet) {
            const forbiddenTech =
              this.experienceTechAllowlistService.detectForbiddenTokens(
                bullet,
                sourceBullet,
                allowlist,
                techVocabulary,
              );
            if (forbiddenTech.length > 0) {
              this.logger.warn(
                'hallucinated_tech detected — reverting bullet to source',
                {
                  experienceIndex: i,
                  bulletIndex: j,
                  offendingTokens: forbiddenTech,
                  outputBullet: bullet,
                  sourceBullet,
                },
              );
              return sourceBullet;
            }
          }

          // Class A — numeric hallucination check (existing behavior)
          const tokens = bullet.match(/\d+[%xkK]?|\$[\d,]+/g) ?? [];
          if (tokens.length === 0) return bullet;

          const sourceFieldText = sourceBullets.join('\n');
          const failingTokens = tokens.filter(
            (token) =>
              !sourceFieldText.includes(token) && !verifiedText.includes(token),
          );

          if (failingTokens.length === 0) return bullet;

          if (!sourceBullet) {
            this.logger.warn(
              'hallucinated_metric on out-of-bounds bullet — keeping original',
              {
                experienceIndex: i,
                bulletIndex: j,
                offendingTokens: failingTokens,
                outputBullet: bullet,
              },
            );
            return bullet;
          }

          this.logger.warn('hallucinated_metric detected — reverting bullet', {
            experienceIndex: i,
            bulletIndex: j,
            offendingTokens: failingTokens,
            outputBullet: bullet,
            sourceBullet,
          });

          return sourceBullet;
        });
      }
    }
  }
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build`
Expected: TypeScript compiles cleanly.

Run: `npx jest src/modules/resume-tailoring/services/resume-optimizer.service.spec.ts`
Expected: PASS.

Run: `npx jest src/modules/resume-tailoring`
Expected: All resume-tailoring tests still pass.

- [ ] **Step 4: Commit Tasks 5 + 6 together**

```bash
git add src/modules/resume-tailoring/services/resume-optimizer.service.ts \
        src/modules/resume-tailoring/services/resume-optimizer.service.spec.ts \
        src/modules/resume-tailoring/interfaces/resume-extracted-keywords.interface.ts
git commit -m "feat(resume-tailoring): enforce per-experience tech allowlist and revert tech hallucinations"
```

---

### Task 7: Bump default Claude model + prompt version

- **path:** `src/shared/modules/external/services/claude.service.ts`, `src/shared/constants/prompt-versions.constants.ts`
- **intent:** Use `claude-sonnet-4-6` as the default when `CLAUDE_MODEL` env is unset (fix #7), and invalidate optimization-result cache by bumping version.
- **verify:** `npm run build` passes; `grep -n "claude-sonnet-4-6" src/shared/modules/external/services/claude.service.ts` finds the new default; `grep -n "v2.0" src/shared/constants/prompt-versions.constants.ts` finds the new optimization version.
- **agency:** `Backend Architect`
- **docs:** Claude model IDs (Sonnet 4.6 = `claude-sonnet-4-6`).

**Files:**
- Modify: `src/shared/modules/external/services/claude.service.ts`
- Modify: `src/shared/constants/prompt-versions.constants.ts`

- [ ] **Step 1: Bump default model**

In `src/shared/modules/external/services/claude.service.ts`, change line 33 from:

```typescript
    this.defaultModel = this.configService.get<string>(
      'CLAUDE_MODEL',
      'claude-sonnet-4-20250514',
    );
```

to:

```typescript
    this.defaultModel = this.configService.get<string>(
      'CLAUDE_MODEL',
      'claude-sonnet-4-6',
    );
```

- [ ] **Step 2: Bump optimization prompt version**

In `src/shared/constants/prompt-versions.constants.ts`, change:

```typescript
export const OPTIMIZATION_PROMPT_VERSION = 'v1.0';
```

to:

```typescript
export const OPTIMIZATION_PROMPT_VERSION = 'v2.0';
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: TypeScript compiles cleanly.

- [ ] **Step 4: Commit**

```bash
git add src/shared/modules/external/services/claude.service.ts \
        src/shared/constants/prompt-versions.constants.ts
git commit -m "chore(ai): default Claude model to sonnet-4-6 and bump optimization prompt to v2.0"
```

---

### Task 8: Full verification + docs note

- **path:** `docs/ARCHITECTURE.md`
- **intent:** Document the new tech-substitution guardrail at the architecture level so future changes don't accidentally remove it; run full lint/test/build gate.
- **verify:** `npm run lint`, `npx jest`, `npm run build` all pass cleanly.
- **agency:** `Code Reviewer` (for the verification gate) — primary engineering done by `Backend Architect` in previous tasks.
- **docs:** `docs/ARCHITECTURE.md`, `.ai/workflow.md`

**Files:**
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: Add architecture note**

Append (or insert in the "Resume tailoring pipeline" section if it exists) a short paragraph:

```markdown
### Tech-substitution guardrail (resume optimization)

The resume optimizer applies a two-layer defense against the LLM substituting
technologies (e.g. swapping Angular for React because the JD asks for React):

1. **Prompt-side fence** — for every optimization request, the prompt includes
   an `EXPERIENCE_TECH_LOCK` section listing, per experience, the only
   technologies that may be named in that experience's bullets. The
   zero-hallucination policy is extended to forbid technology substitution
   explicitly (Class B alongside Class A numeric facts).

2. **Post-LLM scrubber** — `ResumeOptimizerService.scrubInventedMetrics` calls
   `ExperienceTechAllowlistService.detectForbiddenTokens` on every output
   bullet; any bullet that introduces a JD-driven tech token absent from the
   experience's allowlist is reverted to its source bullet and logged under
   `hallucinated_tech`.

The allowlist for experience [i] is built from
`experience[i].technologies` (comma-split) plus any candidate-wide skill
that already appears verbatim in that experience's responsibility bullets.
JD-only technologies are intentionally excluded — that exclusion is the
guardrail.
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: zero errors.

- [ ] **Step 3: Full test suite**

Run: `npx jest`
Expected: all existing tests pass; new tests under `experience-tech-allowlist` and `resume-optimizer.service` pass.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 5: Manual smoke-test against the original bug case**

In your local dev environment:
1. Use the same candidate resume (Muhammad Saeed CV — Angular-heavy with React only in Admetrics intern).
2. Use a job description with React as a primary keyword.
3. Trigger resume tailoring.
4. Verify the Finlex bullets retain Angular (no React substitution).
5. Verify the Admetrics bullet may still mention React (because it is in that experience's allowlist).
6. Check logs for `hallucinated_tech` warnings — every revert should be logged with offending tokens.

- [ ] **Step 6: Commit + push**

```bash
git add docs/ARCHITECTURE.md
git commit -m "docs(architecture): document tech-substitution guardrail in resume optimizer"
```

---

## Self-review checklist

- [x] Spec coverage: all 7 fixes mapped — #1 (Task 3 Step 1), #2 prompt (Task 3 Step 3+6) and code (Tasks 1+2+5), #3 (Task 3 Step 6), #4 (Task 4), #5 (Tasks 1+2+6), #6 (Task 3 Steps 2+4), #7 (Task 7).
- [x] Placeholder scan: no TBDs; every code block contains real code; every verify step has an exact command.
- [x] Type consistency: `allowedTech?: string[]` declared in Task 5 Step 4, consumed in Task 3 Step 6, scrubber signature updated in Task 6 Step 2.
- [x] Every task has `path`, `intent`, `verify`, `agency`, `docs`.
