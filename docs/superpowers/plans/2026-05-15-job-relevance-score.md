# Job Relevance Score (Pre-Generation Gate) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Per ai-dev-setup contract:** every task carries `path`, `intent`, `verify`, `agency`, `docs`. Each task dispatched via Agency `subagentType` — never `general-purpose`.

**Goal:** Add a pre-generation job-fit gate that scores how well the candidate's profile matches a job description and warns the user (with a structured modal) before tailoring runs on a poor-fit job — without regressing latency on high-fit happy paths.

**Architecture:** New `JobRelevanceModule` exposing a single service that runs (a) Redis cache lookup, (b) keyword fast-path skip, then (c) an Anthropic Haiku 4.5 tool-use call with prompt caching for the ambiguous middle. Inside `ResumeGenerationOrchestratorService`, relevance scoring fires **speculatively in parallel** with the tailoring pipeline via an `AbortController`. If the score resolves below threshold before tailoring completes, the tailor job is aborted and the controller returns a structured JSON warning (HTTP 200) instead of a PDF. Frontend modal renders the warning; user can `Cancel` or resubmit with `acknowledgeLowFit: true`. Batch v2 runs the same check synchronously per job before enqueue.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Redis (via existing BullMQ Redis), Anthropic SDK (existing `@anthropic-ai/sdk`). New TypeScript module: `src/modules/job-relevance/`.

**UX note (frontend repo, out of scope for this plan):** The frontend modal must follow the existing app theme but adopt 2026 design trends — soft-glass/translucent surface, subtle motion (entrance ease-out 200ms, dimension bars animate 0→target over 400ms), `prefers-reduced-motion` respected, semantic color tokens for verdict (low/medium/high), accessible focus ring, large readable score number with progressive disclosure for bullet lists. See Appendix B for the frontend contract.

---

## File Structure

### New files (backend)

```
src/modules/job-relevance/
  job-relevance.module.ts
  job-relevance.service.ts
  clients/
    job-relevance-llm.client.ts
  cache/
    job-relevance-cache.service.ts
  fast-path/
    job-relevance-keyword-fast-path.service.ts
  interfaces/
    job-relevance.interface.ts
    job-relevance-input.interface.ts
  enums/
    job-relevance-verdict.enum.ts
    job-relevance-engine.enum.ts
    job-relevance-dimension-label.enum.ts
  constants/
    job-relevance.constants.ts
  prompts/
    job-relevance.prompt.ts
src/database/migrations/
  1815000000000-AddPreGenerationRelevanceToResumeGenerations.ts
```

### Modified files (backend)

```
src/app.module.ts                                                                (register JobRelevanceModule)
src/database/entities/resume-generations.entity.ts                              (+ preGenerationRelevance JSONB column)
src/modules/resume-tailoring/resume-tailoring.module.ts                         (import JobRelevanceModule)
src/modules/resume-tailoring/dtos/generate-tailored-resume.dto.ts               (+ acknowledgeLowFit?: boolean)
src/modules/resume-tailoring/dtos/batch-generate.dto.ts                         (+ acknowledgeLowFit?: boolean)
src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts (speculative parallel pre-flight)
src/modules/resume-tailoring/resume-tailoring.controller.ts                     (PDF vs JSON discriminator)
src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts  (sync pre-flight per job)
src/modules/resume-tailoring/interfaces/resume-generation.interface.ts          (+ acknowledgeLowFit + result union)
.env.example                                                                     (+ JOB_RELEVANCE_GATE_ENABLED)
```

---

## Agency dispatch map

| Task class | Persona (subagentType) | Cursor rule |
|------------|------------------------|-------------|
| Schema migration | Database Optimizer | `@agency-database-optimizer.mdc` |
| Interfaces / enums / constants | Backend Architect | `@agency-backend-architect.mdc` |
| LLM client + prompt | AI Engineer | `@agency-ai-engineer.mdc` |
| Cache service | Backend Architect | `@agency-backend-architect.mdc` |
| Keyword fast-path | Senior Developer | `@agency-senior-developer.mdc` |
| Core orchestrating service | Backend Architect | `@agency-backend-architect.mdc` |
| Module wiring + DTOs | Senior Developer | `@agency-senior-developer.mdc` |
| Orchestrator integration | Backend Architect | `@agency-backend-architect.mdc` |
| Controller discriminator | Senior Developer | `@agency-senior-developer.mdc` |
| Batch v2 pre-flight | Backend Architect | `@agency-backend-architect.mdc` |
| Final review | Code Reviewer | `@agency-code-reviewer.mdc` |

---

## Task 1 — Add `pre_generation_relevance` column to `resume_generations`

**path:** `src/database/migrations/1815000000000-AddPreGenerationRelevanceToResumeGenerations.ts`, `src/database/entities/resume-generations.entity.ts`
**intent:** Add nullable JSONB column to store pre-generation relevance result; index on verdict for analytics queries.
**verify:** `npm run lint && npm run build` clean; `npm run typeorm:migration:run` succeeds; `\d resume_generations` shows `pre_generation_relevance jsonb` and index `idx_resume_generations_relevance_verdict`.
**agency:** Database Optimizer (`@agency-database-optimizer.mdc`)
**docs:** `docs/CONVENTIONS.md` §NestJS entities, `src/database/migrations/1814901000000-WidenResumesMimeType.ts` (style reference)

**Files:**
- Create: `src/database/migrations/1815000000000-AddPreGenerationRelevanceToResumeGenerations.ts`
- Modify: `src/database/entities/resume-generations.entity.ts`

- [ ] **Step 1: Create migration**

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreGenerationRelevanceToResumeGenerations1815000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE resume_generations
        ADD COLUMN pre_generation_relevance JSONB NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_resume_generations_relevance_verdict
        ON resume_generations ((pre_generation_relevance->>'verdict'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_resume_generations_relevance_verdict`,
    );
    await queryRunner.query(
      `ALTER TABLE resume_generations DROP COLUMN pre_generation_relevance`,
    );
  }
}
```

- [ ] **Step 2: Add column to entity**

In `src/database/entities/resume-generations.entity.ts`, after the last existing `@Column` decorator, add:

```typescript
@Column({ name: 'pre_generation_relevance', type: 'jsonb', nullable: true })
preGenerationRelevance: JobRelevanceResult | null;
```

Add import at the top (use `import type` — interface only):

```typescript
import type { JobRelevanceResult } from '../../modules/job-relevance/interfaces/job-relevance.interface';
```

(`JobRelevanceResult` is defined in Task 2. Replace with `Record<string, unknown> | null` temporarily if Task 2 is not done yet; update after Task 2 lands.)

- [ ] **Step 3: Run migration**

```bash
npm run typeorm:migration:run
```

Expected: migration runs cleanly.

- [ ] **Step 4: Verify column**

```bash
psql $DATABASE_URL -c "\d resume_generations" | grep pre_generation_relevance
```

Expected: `pre_generation_relevance | jsonb |`.

- [ ] **Step 5: Lint + build**

```bash
npm run lint && npm run build
```

Expected: zero errors.

---

## Task 2 — Domain types, enums, constants

**path:** `src/modules/job-relevance/interfaces/job-relevance.interface.ts`, `src/modules/job-relevance/interfaces/job-relevance-input.interface.ts`, `src/modules/job-relevance/enums/job-relevance-verdict.enum.ts`, `src/modules/job-relevance/enums/job-relevance-engine.enum.ts`, `src/modules/job-relevance/enums/job-relevance-dimension-label.enum.ts`, `src/modules/job-relevance/constants/job-relevance.constants.ts`
**intent:** Lock the domain language — every later task references these names, no inline types or magic strings anywhere.
**verify:** `npm run lint && npm run build` clean.
**agency:** Backend Architect (`@agency-backend-architect.mdc`)
**docs:** `docs/CONVENTIONS.md` §Type, interface, and enum placement

**Files:**
- Create: `src/modules/job-relevance/enums/job-relevance-verdict.enum.ts`
- Create: `src/modules/job-relevance/enums/job-relevance-engine.enum.ts`
- Create: `src/modules/job-relevance/enums/job-relevance-dimension-label.enum.ts`
- Create: `src/modules/job-relevance/interfaces/job-relevance.interface.ts`
- Create: `src/modules/job-relevance/interfaces/job-relevance-input.interface.ts`
- Create: `src/modules/job-relevance/constants/job-relevance.constants.ts`

- [ ] **Step 1: Verdict enum**

`src/modules/job-relevance/enums/job-relevance-verdict.enum.ts`:

```typescript
export enum JobRelevanceVerdict {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}
```

- [ ] **Step 2: Engine enum**

`src/modules/job-relevance/enums/job-relevance-engine.enum.ts`:

```typescript
export enum JobRelevanceEngine {
  LLM = 'llm',
  KEYWORD_FAST_PATH = 'keyword-fast-path',
  CACHE_HIT = 'cache-hit',
  FALLBACK = 'fallback',
  TIMEOUT = 'timeout',
  SKIPPED = 'skipped',
}
```

- [ ] **Step 3: Dimension label enum**

`src/modules/job-relevance/enums/job-relevance-dimension-label.enum.ts`:

```typescript
export enum JobRelevanceDimensionLabel {
  MISMATCH = 'Mismatch',
  PARTIAL = 'Partial',
  ALIGNED = 'Aligned',
}
```

- [ ] **Step 4: Result interface**

`src/modules/job-relevance/interfaces/job-relevance.interface.ts`:

```typescript
import type { JobRelevanceVerdict } from '../enums/job-relevance-verdict.enum';
import type { JobRelevanceEngine } from '../enums/job-relevance-engine.enum';
import type { JobRelevanceDimensionLabel } from '../enums/job-relevance-dimension-label.enum';

export interface JobRelevanceDimension {
  score: number;
  label: JobRelevanceDimensionLabel;
}

export interface JobRelevanceDimensions {
  techStack: JobRelevanceDimension;
  roleType: JobRelevanceDimension;
  experienceLevel: JobRelevanceDimension;
}

export interface JobRelevanceResult {
  score: number;
  verdict: JobRelevanceVerdict;
  dimensions: JobRelevanceDimensions;
  gaps: string[];
  strengths: string[];
  engine: JobRelevanceEngine;
  model: string | null;
  latencyMs: number;
  cacheKey: string | null;
  computedAt: string;
  acknowledgedLowFit: boolean;
}
```

- [ ] **Step 5: Input interface**

`src/modules/job-relevance/interfaces/job-relevance-input.interface.ts`:

```typescript
import type { TailoredContent } from '../../resume-tailoring/interfaces/resume-extracted-keywords.interface';

export type JobRelevanceProfileSource =
  | { kind: 'enriched'; profileVersion: number; content: TailoredContent }
  | { kind: 'extracted'; content: TailoredContent }
  | { kind: 'raw-text'; text: string }
  | { kind: 'none' };

export interface JobRelevanceInput {
  userId: string | null;
  profile: JobRelevanceProfileSource;
  jobPosition: string;
  companyName: string;
  jobDescription: string;
  abortSignal?: AbortSignal;
}
```

- [ ] **Step 6: Constants**

`src/modules/job-relevance/constants/job-relevance.constants.ts`:

```typescript
export const JOB_RELEVANCE_CONSTANTS = {
  THRESHOLDS: {
    LOW_MAX: 39,
    MEDIUM_MAX: 65,
  },
  LLM: {
    MODEL: 'claude-haiku-4-5-20251001',
    MAX_TOKENS: 350,
    TIMEOUT_MS: 1500,
    RETRY_DELAY_MS: 200,
    MAX_RETRIES: 1,
    TOOL_NAME: 'score_job_relevance',
  },
  CACHE: {
    TTL_SECONDS: 60 * 60 * 24,
    KEY_PREFIX: 'relevance:v1',
  },
  TRUNCATION: {
    JD_MAX_CHARS: 3000,
    PROFILE_MAX_CHARS: 8000,
  },
  KEYWORD_FAST_PATH: {
    HIGH_SKIP_THRESHOLD: 75,
    LOW_SKIP_THRESHOLD: 15,
  },
  DIMENSION_WEIGHTS: {
    TECH_STACK: 0.4,
    ROLE_TYPE: 0.3,
    EXPERIENCE_LEVEL: 0.3,
  },
  FEATURE_FLAG_ENV: 'JOB_RELEVANCE_GATE_ENABLED',
  RESPONSE_TYPES: {
    LOW_FIT_WARNING: 'low_fit_warning',
    BATCH_LOW_FIT_WARNING: 'batch_low_fit_warning',
  },
  HEADERS: {
    RELEVANCE_SCORE: 'X-Relevance-Score',
    RELEVANCE_VERDICT: 'X-Relevance-Verdict',
    RELEVANCE_CACHE_HIT: 'X-Relevance-Cache-Hit',
  },
  DB: {
    REDIS_PROVIDER_TOKEN: 'JOB_RELEVANCE_REDIS',
  },
} as const;
```

- [ ] **Step 7: Lint + build**

```bash
npm run lint && npm run build
```

Expected: zero errors. (The `import type` in `resume-generations.entity.ts` from Task 1 now fully resolves.)

---

## Task 3 — `JobRelevanceCacheService` (Redis)

**path:** `src/modules/job-relevance/cache/job-relevance-cache.service.ts`
**intent:** Read/write `JobRelevanceResult` keyed by `(profileVersion, jdHash)`; survive Redis outage by failing open.
**verify:** `npm run lint && npm run build` clean.
**agency:** Backend Architect (`@agency-backend-architect.mdc`)
**docs:** `docs/CONVENTIONS.md` §NestJS, `src/app.module.ts` (Redis config reference for host/port/password/db env keys)

**Files:**
- Create: `src/modules/job-relevance/cache/job-relevance-cache.service.ts`

- [ ] **Step 1: Implement service**

`src/modules/job-relevance/cache/job-relevance-cache.service.ts`:

```typescript
import { Injectable, Inject, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type IORedis from 'ioredis';
import { JOB_RELEVANCE_CONSTANTS } from '../constants/job-relevance.constants';
import type { JobRelevanceResult } from '../interfaces/job-relevance.interface';

@Injectable()
export class JobRelevanceCacheService {
  private readonly logger = new Logger(JobRelevanceCacheService.name);

  constructor(
    @Inject(JOB_RELEVANCE_CONSTANTS.DB.REDIS_PROVIDER_TOKEN)
    private readonly redis: IORedis,
  ) {}

  buildKey(profileVersion: number, jobDescription: string): string {
    const normalized = jobDescription.trim().replace(/\s+/g, ' ').toLowerCase();
    const hash = createHash('sha1').update(normalized).digest('hex');
    return `${JOB_RELEVANCE_CONSTANTS.CACHE.KEY_PREFIX}:${profileVersion}:${hash}`;
  }

  async get(key: string): Promise<JobRelevanceResult | null> {
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as JobRelevanceResult;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${key}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async set(key: string, value: JobRelevanceResult): Promise<void> {
    try {
      await this.redis.set(
        key,
        JSON.stringify(value),
        'EX',
        JOB_RELEVANCE_CONSTANTS.CACHE.TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${key}: ${(err as Error).message}`,
      );
    }
  }
}
```

- [ ] **Step 2: Lint + build**

```bash
npm run lint && npm run build
```

Expected: zero errors.

---

## Task 4 — `JobRelevanceKeywordFastPathService`

**path:** `src/modules/job-relevance/fast-path/job-relevance-keyword-fast-path.service.ts`
**intent:** Use `KeywordMatchScoringService` to decide whether overlap alone is enough — high overlap returns synthetic high result, low overlap returns synthetic low result, middle returns `null` to trigger LLM.
**verify:** `npm run lint && npm run build` clean.
**agency:** Senior Developer (`@agency-senior-developer.mdc`)
**docs:** `src/modules/resume-tailoring/services/keyword-match-scoring.service.ts` (engine signature reference)

**Files:**
- Create: `src/modules/job-relevance/fast-path/job-relevance-keyword-fast-path.service.ts`

- [ ] **Step 1: Implement service**

`src/modules/job-relevance/fast-path/job-relevance-keyword-fast-path.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { KeywordMatchScoringService } from '../../resume-tailoring/services/keyword-match-scoring.service';
import { JOB_RELEVANCE_CONSTANTS } from '../constants/job-relevance.constants';
import { JobRelevanceVerdict } from '../enums/job-relevance-verdict.enum';
import { JobRelevanceEngine } from '../enums/job-relevance-engine.enum';
import { JobRelevanceDimensionLabel } from '../enums/job-relevance-dimension-label.enum';
import type { JobRelevanceResult } from '../interfaces/job-relevance.interface';

@Injectable()
export class JobRelevanceKeywordFastPathService {
  constructor(
    private readonly keywordScorer: KeywordMatchScoringService,
  ) {}

  tryScore(profileText: string, jobDescription: string): JobRelevanceResult | null {
    const overlap = this.keywordScorer.computeScore(profileText, jobDescription);
    const { HIGH_SKIP_THRESHOLD, LOW_SKIP_THRESHOLD } =
      JOB_RELEVANCE_CONSTANTS.KEYWORD_FAST_PATH;

    if (overlap >= HIGH_SKIP_THRESHOLD) {
      return this.buildSynthetic(
        overlap,
        JobRelevanceVerdict.HIGH,
        [],
        ['Strong keyword overlap between profile and job description'],
        JobRelevanceDimensionLabel.ALIGNED,
      );
    }

    if (overlap <= LOW_SKIP_THRESHOLD) {
      return this.buildSynthetic(
        overlap,
        JobRelevanceVerdict.LOW,
        ['Profile keywords show minimal overlap with this job description'],
        [],
        JobRelevanceDimensionLabel.MISMATCH,
      );
    }

    return null;
  }

  private buildSynthetic(
    score: number,
    verdict: JobRelevanceVerdict,
    gaps: string[],
    strengths: string[],
    dimLabel: JobRelevanceDimensionLabel,
  ): JobRelevanceResult {
    return {
      score,
      verdict,
      dimensions: {
        techStack: { score, label: dimLabel },
        roleType: { score, label: dimLabel },
        experienceLevel: { score, label: dimLabel },
      },
      gaps,
      strengths,
      engine: JobRelevanceEngine.KEYWORD_FAST_PATH,
      model: null,
      latencyMs: 0,
      cacheKey: null,
      computedAt: new Date().toISOString(),
      acknowledgedLowFit: false,
    };
  }
}
```

- [ ] **Step 2: Lint + build**

```bash
npm run lint && npm run build
```

Expected: zero errors.

---

## Task 5 — Prompt builder + `JobRelevanceLlmClient`

**path:** `src/modules/job-relevance/prompts/job-relevance.prompt.ts`, `src/modules/job-relevance/clients/job-relevance-llm.client.ts`
**intent:** Encapsulate the Anthropic tool-use call with prompt caching (rubric system block + per-user profile system block), 1.5s hard timeout via `AbortController`, single retry with delay, strict schema validation of the tool-use output, and abort-signal propagation from the orchestrator. No magic strings — all literals come from `JOB_RELEVANCE_CONSTANTS`.
**verify:** `npm run lint && npm run build` clean.
**agency:** AI Engineer (`@agency-ai-engineer.mdc`)
**docs:** `src/shared/services/prompt.service.ts` §604 (existing prompt-caching pattern), `src/modules/resume-tailoring/services/resume-optimizer.service.ts` (existing Anthropic client instantiation pattern)

**Files:**
- Create: `src/modules/job-relevance/prompts/job-relevance.prompt.ts`
- Create: `src/modules/job-relevance/clients/job-relevance-llm.client.ts`

- [ ] **Step 1: Prompt builder**

`src/modules/job-relevance/prompts/job-relevance.prompt.ts`:

```typescript
import { JOB_RELEVANCE_CONSTANTS } from '../constants/job-relevance.constants';
import { JobRelevanceDimensionLabel } from '../enums/job-relevance-dimension-label.enum';
import { JobRelevanceVerdict } from '../enums/job-relevance-verdict.enum';

const VERDICT_VALUES = Object.values(JobRelevanceVerdict);
const LABEL_VALUES = Object.values(JobRelevanceDimensionLabel);

export const RELEVANCE_TOOL = {
  name: JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME,
  description:
    'Score how well a candidate profile matches a job description across tech stack, role type, and experience level.',
  input_schema: {
    type: 'object' as const,
    required: ['score', 'verdict', 'dimensions', 'gaps', 'strengths'],
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 100 },
      verdict: { type: 'string', enum: VERDICT_VALUES },
      dimensions: {
        type: 'object',
        required: ['techStack', 'roleType', 'experienceLevel'],
        properties: {
          techStack: {
            type: 'object',
            required: ['score', 'label'],
            properties: {
              score: { type: 'integer', minimum: 0, maximum: 100 },
              label: { type: 'string', enum: LABEL_VALUES },
            },
          },
          roleType: {
            type: 'object',
            required: ['score', 'label'],
            properties: {
              score: { type: 'integer', minimum: 0, maximum: 100 },
              label: { type: 'string', enum: LABEL_VALUES },
            },
          },
          experienceLevel: {
            type: 'object',
            required: ['score', 'label'],
            properties: {
              score: { type: 'integer', minimum: 0, maximum: 100 },
              label: { type: 'string', enum: LABEL_VALUES },
            },
          },
        },
      },
      gaps: {
        type: 'array',
        maxItems: 4,
        items: { type: 'string', maxLength: 160 },
      },
      strengths: {
        type: 'array',
        maxItems: 3,
        items: { type: 'string', maxLength: 160 },
      },
    },
  },
};

export const RUBRIC_SYSTEM_BLOCK = `You are a job-fit analyst. Score how well a candidate's background matches a job description.

<scoring_rubric>
  Weights: techStack ${JOB_RELEVANCE_CONSTANTS.DIMENSION_WEIGHTS.TECH_STACK * 100}%, roleType ${JOB_RELEVANCE_CONSTANTS.DIMENSION_WEIGHTS.ROLE_TYPE * 100}%, experienceLevel ${JOB_RELEVANCE_CONSTANTS.DIMENSION_WEIGHTS.EXPERIENCE_LEVEL * 100}%.
  score = round(weighted sum).
  verdict: score <= ${JOB_RELEVANCE_CONSTANTS.THRESHOLDS.LOW_MAX} -> "${JobRelevanceVerdict.LOW}"; score <= ${JOB_RELEVANCE_CONSTANTS.THRESHOLDS.MEDIUM_MAX} -> "${JobRelevanceVerdict.MEDIUM}"; otherwise -> "${JobRelevanceVerdict.HIGH}".
  label per dimension: <40 ${JobRelevanceDimensionLabel.MISMATCH}, 40-65 ${JobRelevanceDimensionLabel.PARTIAL}, >65 ${JobRelevanceDimensionLabel.ALIGNED}.

  Be specific in gaps and strengths — name the actual technologies and role aspects, not generic phrases.
  Output ONLY by calling the ${JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME} tool.
</scoring_rubric>`;

export function buildCandidateProfileBlock(profileText: string): string {
  const truncated = profileText.slice(
    0,
    JOB_RELEVANCE_CONSTANTS.TRUNCATION.PROFILE_MAX_CHARS,
  );
  return `<candidate_profile>\n${truncated}\n</candidate_profile>`;
}

export function buildJobBlock(
  jobPosition: string,
  companyName: string,
  jobDescription: string,
): string {
  const jd = jobDescription.slice(0, JOB_RELEVANCE_CONSTANTS.TRUNCATION.JD_MAX_CHARS);
  return `<position>${jobPosition}</position>
<company>${companyName}</company>
<job_description>
${jd}
</job_description>

Call ${JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME} with your assessment.`;
}
```

- [ ] **Step 2: Implement LLM client**

`src/modules/job-relevance/clients/job-relevance-llm.client.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { JOB_RELEVANCE_CONSTANTS } from '../constants/job-relevance.constants';
import {
  RELEVANCE_TOOL,
  RUBRIC_SYSTEM_BLOCK,
  buildCandidateProfileBlock,
  buildJobBlock,
} from '../prompts/job-relevance.prompt';
import { JobRelevanceVerdict } from '../enums/job-relevance-verdict.enum';
import { JobRelevanceEngine } from '../enums/job-relevance-engine.enum';
import { JobRelevanceDimensionLabel } from '../enums/job-relevance-dimension-label.enum';
import type {
  JobRelevanceResult,
  JobRelevanceDimensions,
} from '../interfaces/job-relevance.interface';

interface ScoreParams {
  profileText: string;
  jobPosition: string;
  companyName: string;
  jobDescription: string;
  abortSignal?: AbortSignal;
}

@Injectable()
export class JobRelevanceLlmClient {
  private readonly logger = new Logger(JobRelevanceLlmClient.name);
  private readonly anthropic: Anthropic;

  constructor(private readonly config: ConfigService) {
    this.anthropic = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY') ?? '',
    });
  }

  async score(params: ScoreParams): Promise<JobRelevanceResult> {
    const started = Date.now();
    try {
      const response = await this.callWithTimeout(params);
      const parsed = this.parseToolUse(response);
      if (!parsed) return this.buildFallback(JobRelevanceEngine.FALLBACK, started);
      return this.toResult(parsed, started);
    } catch (err) {
      const isAbort =
        (err as Error).name === 'AbortError' ||
        (err as Error).message?.includes('aborted');
      if (!isAbort) {
        this.logger.warn(`LLM relevance call failed: ${(err as Error).message}`);
      }
      return this.buildFallback(
        isAbort ? JobRelevanceEngine.TIMEOUT : JobRelevanceEngine.FALLBACK,
        started,
      );
    }
  }

  private async callWithTimeout(params: ScoreParams) {
    const internalAc = new AbortController();
    const timer = setTimeout(
      () => internalAc.abort(),
      JOB_RELEVANCE_CONSTANTS.LLM.TIMEOUT_MS,
    );
    if (params.abortSignal) {
      params.abortSignal.addEventListener('abort', () => internalAc.abort(), {
        once: true,
      });
    }

    try {
      return await this.anthropic.messages.create(
        {
          model: JOB_RELEVANCE_CONSTANTS.LLM.MODEL,
          max_tokens: JOB_RELEVANCE_CONSTANTS.LLM.MAX_TOKENS,
          tools: [RELEVANCE_TOOL],
          tool_choice: {
            type: 'tool',
            name: JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME,
          },
          system: [
            {
              type: 'text',
              text: RUBRIC_SYSTEM_BLOCK,
              cache_control: { type: 'ephemeral' },
            },
            {
              type: 'text',
              text: buildCandidateProfileBlock(params.profileText),
              cache_control: { type: 'ephemeral' },
            },
          ],
          messages: [
            {
              role: 'user',
              content: buildJobBlock(
                params.jobPosition,
                params.companyName,
                params.jobDescription,
              ),
            },
          ],
        },
        { signal: internalAc.signal },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private parseToolUse(
    response: Anthropic.Message,
  ): {
    score: number;
    verdict: JobRelevanceVerdict;
    dimensions: JobRelevanceDimensions;
    gaps: string[];
    strengths: string[];
  } | null {
    const block = response.content?.find(
      (b) =>
        b.type === 'tool_use' &&
        b.name === JOB_RELEVANCE_CONSTANTS.LLM.TOOL_NAME,
    ) as (Anthropic.ToolUseBlock & { input: Record<string, unknown> }) | undefined;

    if (!block || typeof block.input !== 'object' || block.input === null) {
      return null;
    }
    const input = block.input;

    if (typeof input.score !== 'number') return null;
    const verdictValues = Object.values(JobRelevanceVerdict) as string[];
    if (!verdictValues.includes(input.verdict as string)) return null;

    const dims = input.dimensions as Record<
      string,
      { score: number; label: string }
    >;
    if (!dims?.techStack || !dims?.roleType || !dims?.experienceLevel) {
      return null;
    }

    return {
      score: Math.round(input.score),
      verdict: input.verdict as JobRelevanceVerdict,
      dimensions: {
        techStack: this.toDim(dims.techStack),
        roleType: this.toDim(dims.roleType),
        experienceLevel: this.toDim(dims.experienceLevel),
      },
      gaps: Array.isArray(input.gaps)
        ? (input.gaps as string[]).slice(0, 4)
        : [],
      strengths: Array.isArray(input.strengths)
        ? (input.strengths as string[]).slice(0, 3)
        : [],
    };
  }

  private toDim(d: { score: number; label: string }): {
    score: number;
    label: JobRelevanceDimensionLabel;
  } {
    const labelValues = Object.values(JobRelevanceDimensionLabel) as string[];
    const label = labelValues.includes(d.label)
      ? (d.label as JobRelevanceDimensionLabel)
      : JobRelevanceDimensionLabel.PARTIAL;
    return { score: Math.round(d.score), label };
  }

  private toResult(
    parsed: NonNullable<ReturnType<JobRelevanceLlmClient['parseToolUse']>>,
    started: number,
  ): JobRelevanceResult {
    return {
      ...parsed,
      engine: JobRelevanceEngine.LLM,
      model: JOB_RELEVANCE_CONSTANTS.LLM.MODEL,
      latencyMs: Date.now() - started,
      cacheKey: null,
      computedAt: new Date().toISOString(),
      acknowledgedLowFit: false,
    };
  }

  private buildFallback(
    engine: JobRelevanceEngine,
    started: number,
  ): JobRelevanceResult {
    return {
      score: 0,
      verdict: JobRelevanceVerdict.MEDIUM,
      dimensions: {
        techStack: { score: 0, label: JobRelevanceDimensionLabel.PARTIAL },
        roleType: { score: 0, label: JobRelevanceDimensionLabel.PARTIAL },
        experienceLevel: { score: 0, label: JobRelevanceDimensionLabel.PARTIAL },
      },
      gaps: [],
      strengths: [],
      engine,
      model: null,
      latencyMs: Date.now() - started,
      cacheKey: null,
      computedAt: new Date().toISOString(),
      acknowledgedLowFit: false,
    };
  }
}
```

- [ ] **Step 3: Lint + build**

```bash
npm run lint && npm run build
```

Expected: zero errors.

---

## Task 6 — Core `JobRelevanceService`

**path:** `src/modules/job-relevance/job-relevance.service.ts`
**intent:** Single entry-point. Resolves profile tier, computes cache key, tries cache → fast-path → LLM → fallback. Applies kill-switch. Returns `JobRelevanceResult` in all paths.
**verify:** `npm run lint && npm run build` clean.
**agency:** Backend Architect (`@agency-backend-architect.mdc`)
**docs:** `docs/CONVENTIONS.md` §Layer separation, `docs/ERROR-HANDLING.md`

**Files:**
- Create: `src/modules/job-relevance/job-relevance.service.ts`

- [ ] **Step 1: Implement service**

`src/modules/job-relevance/job-relevance.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobRelevanceCacheService } from './cache/job-relevance-cache.service';
import { JobRelevanceKeywordFastPathService } from './fast-path/job-relevance-keyword-fast-path.service';
import { JobRelevanceLlmClient } from './clients/job-relevance-llm.client';
import { JOB_RELEVANCE_CONSTANTS } from './constants/job-relevance.constants';
import { JobRelevanceEngine } from './enums/job-relevance-engine.enum';
import { JobRelevanceVerdict } from './enums/job-relevance-verdict.enum';
import { JobRelevanceDimensionLabel } from './enums/job-relevance-dimension-label.enum';
import type { JobRelevanceResult } from './interfaces/job-relevance.interface';
import type {
  JobRelevanceInput,
  JobRelevanceProfileSource,
} from './interfaces/job-relevance-input.interface';

@Injectable()
export class JobRelevanceService {
  private readonly logger = new Logger(JobRelevanceService.name);

  constructor(
    private readonly cache: JobRelevanceCacheService,
    private readonly fastPath: JobRelevanceKeywordFastPathService,
    private readonly llm: JobRelevanceLlmClient,
    private readonly config: ConfigService,
  ) {}

  async score(input: JobRelevanceInput): Promise<JobRelevanceResult> {
    if (!this.isEnabled()) return this.buildSkipped();
    if (input.profile.kind === 'none') return this.buildSkipped();

    const profileText = this.flattenProfile(input.profile);
    if (!profileText.trim()) return this.buildSkipped();

    const profileVersion =
      input.profile.kind === 'enriched' ? input.profile.profileVersion : 0;
    const cacheKey = this.cache.buildKey(profileVersion, input.jobDescription);

    const cached = await this.cache.get(cacheKey);
    if (cached) {
      const hit: JobRelevanceResult = {
        ...cached,
        engine: JobRelevanceEngine.CACHE_HIT,
        cacheKey,
      };
      this.log(input, hit);
      return hit;
    }

    const fast = this.fastPath.tryScore(profileText, input.jobDescription);
    if (fast) {
      const result: JobRelevanceResult = { ...fast, cacheKey };
      await this.cache.set(cacheKey, result);
      this.log(input, result);
      return result;
    }

    const llmResult = await this.llm.score({
      profileText,
      jobPosition: input.jobPosition,
      companyName: input.companyName,
      jobDescription: input.jobDescription,
      abortSignal: input.abortSignal,
    });

    const final: JobRelevanceResult = { ...llmResult, cacheKey };
    if (final.engine === JobRelevanceEngine.LLM) {
      await this.cache.set(cacheKey, final);
    }
    this.log(input, final);
    return final;
  }

  private isEnabled(): boolean {
    return (
      this.config.get<string>(JOB_RELEVANCE_CONSTANTS.FEATURE_FLAG_ENV) ===
      'true'
    );
  }

  private flattenProfile(source: JobRelevanceProfileSource): string {
    if (source.kind === 'enriched' || source.kind === 'extracted') {
      try {
        return JSON.stringify(source.content);
      } catch {
        return '';
      }
    }
    if (source.kind === 'raw-text') return source.text;
    return '';
  }

  private buildSkipped(): JobRelevanceResult {
    return {
      score: 100,
      verdict: JobRelevanceVerdict.HIGH,
      dimensions: {
        techStack: { score: 100, label: JobRelevanceDimensionLabel.ALIGNED },
        roleType: { score: 100, label: JobRelevanceDimensionLabel.ALIGNED },
        experienceLevel: {
          score: 100,
          label: JobRelevanceDimensionLabel.ALIGNED,
        },
      },
      gaps: [],
      strengths: [],
      engine: JobRelevanceEngine.SKIPPED,
      model: null,
      latencyMs: 0,
      cacheKey: null,
      computedAt: new Date().toISOString(),
      acknowledgedLowFit: false,
    };
  }

  private log(input: JobRelevanceInput, result: JobRelevanceResult): void {
    this.logger.log(
      `[JobRelevance] user=${input.userId ?? 'anon'} engine=${result.engine} score=${result.score} verdict=${result.verdict} latencyMs=${result.latencyMs} cacheKey=${result.cacheKey ?? 'none'}`,
    );
  }
}
```

- [ ] **Step 2: Lint + build**

```bash
npm run lint && npm run build
```

Expected: zero errors.

---

## Task 7 — `JobRelevanceModule` wiring + Redis provider

**path:** `src/modules/job-relevance/job-relevance.module.ts`, `src/app.module.ts`, `src/modules/resume-tailoring/resume-tailoring.module.ts`
**intent:** Register the new module. Provide a dedicated `ioredis` client using the same env config as BullMQ, bound by the `REDIS_PROVIDER_TOKEN` constant.
**verify:** `npm run lint && npm run build` clean; `npm run start:dev` boots without provider-resolution errors.
**agency:** Senior Developer (`@agency-senior-developer.mdc`)
**docs:** `src/app.module.ts` §35 (BullMQ Redis config), `docs/CONVENTIONS.md` §NestJS module structure

**Files:**
- Create: `src/modules/job-relevance/job-relevance.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/modules/resume-tailoring/resume-tailoring.module.ts`

- [ ] **Step 1: Create module**

`src/modules/job-relevance/job-relevance.module.ts`:

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';
import { JobRelevanceService } from './job-relevance.service';
import { JobRelevanceCacheService } from './cache/job-relevance-cache.service';
import { JobRelevanceKeywordFastPathService } from './fast-path/job-relevance-keyword-fast-path.service';
import { JobRelevanceLlmClient } from './clients/job-relevance-llm.client';
import { JOB_RELEVANCE_CONSTANTS } from './constants/job-relevance.constants';
import { ResumeTailoringModule } from '../resume-tailoring/resume-tailoring.module';

@Module({
  imports: [forwardRef(() => ResumeTailoringModule)],
  providers: [
    {
      provide: JOB_RELEVANCE_CONSTANTS.DB.REDIS_PROVIDER_TOKEN,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new IORedis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          db: config.get<number>('REDIS_DB', 0),
          lazyConnect: true,
          maxRetriesPerRequest: 1,
        }),
    },
    JobRelevanceCacheService,
    JobRelevanceKeywordFastPathService,
    JobRelevanceLlmClient,
    JobRelevanceService,
  ],
  exports: [JobRelevanceService],
})
export class JobRelevanceModule {}
```

- [ ] **Step 2: Register in `app.module.ts`**

Add at the top of `src/app.module.ts`:

```typescript
import { JobRelevanceModule } from './modules/job-relevance/job-relevance.module';
```

Add `JobRelevanceModule` to the `imports` array.

- [ ] **Step 3: Import into `ResumeTailoringModule`**

In `src/modules/resume-tailoring/resume-tailoring.module.ts`, add:

```typescript
import { forwardRef } from '@nestjs/common';
import { JobRelevanceModule } from '../job-relevance/job-relevance.module';
```

Add `forwardRef(() => JobRelevanceModule)` to the `imports` array.

> **Circular-import note:** `JobRelevanceModule` imports `ResumeTailoringModule` (for `KeywordMatchScoringService`). `ResumeTailoringModule` imports `JobRelevanceModule` (for `JobRelevanceService` in the orchestrator). Both sides use `forwardRef` — this is the correct NestJS pattern for circular module dependencies.

- [ ] **Step 4: Lint + build**

```bash
npm run lint && npm run build
```

Expected: zero errors.

- [ ] **Step 5: Boot smoke test**

```bash
npm run start:dev
```

Wait for `Nest application successfully started`. Confirm no provider-resolution errors in output. Then `Ctrl+C`.

---

## Task 8 — DTO + interface additions for `acknowledgeLowFit`

**path:** `src/modules/resume-tailoring/dtos/generate-tailored-resume.dto.ts`, `src/modules/resume-tailoring/dtos/batch-generate.dto.ts`, `src/modules/resume-tailoring/interfaces/resume-generation.interface.ts`
**intent:** Accept the override flag from the client. Add a discriminated union to `ResumeGenerationResult` so the orchestrator and controller can return either a PDF result or a low-fit warning in a type-safe way.
**verify:** `npm run lint && npm run build` clean.
**agency:** Senior Developer (`@agency-senior-developer.mdc`)
**docs:** `docs/CONVENTIONS.md` §Validation, `docs/API-PATTERNS.md` §Request validation

**Files:**
- Modify: `src/modules/resume-tailoring/dtos/generate-tailored-resume.dto.ts`
- Modify: `src/modules/resume-tailoring/dtos/batch-generate.dto.ts`
- Modify: `src/modules/resume-tailoring/interfaces/resume-generation.interface.ts`

- [ ] **Step 1: Check existing DTO fields**

```bash
grep -n "class GenerateTailoredResumeDto" \
  src/modules/resume-tailoring/dtos/generate-tailored-resume.dto.ts
grep -n "class BatchGenerateDto" \
  src/modules/resume-tailoring/dtos/batch-generate.dto.ts
```

- [ ] **Step 2: Add field to single-generate DTO**

In `generate-tailored-resume.dto.ts`, append inside the class body:

```typescript
@IsOptional()
@Transform(({ value }) => value === 'true' || value === true)
@IsBoolean()
acknowledgeLowFit?: boolean;
```

Ensure `IsBoolean`, `IsOptional` are imported from `class-validator` and `Transform` from `class-transformer`. (These are already used in the codebase — add to existing imports.)

> The `@Transform` coercion is necessary because multipart form data sends booleans as the string `"true"`.

- [ ] **Step 3: Add field to batch DTO**

In `batch-generate.dto.ts`, append inside the class body (no `@Transform` — batch body is JSON):

```typescript
@IsOptional()
@IsBoolean()
acknowledgeLowFit?: boolean;
```

- [ ] **Step 4: Add `acknowledgeLowFit` to `ResumeGenerationInput`**

In `src/modules/resume-tailoring/interfaces/resume-generation.interface.ts`, add the field to the existing `ResumeGenerationInput` interface:

```typescript
acknowledgeLowFit?: boolean;
```

- [ ] **Step 5: Add discriminated union for `ResumeGenerationResult`**

In the same file, replace the existing `ResumeGenerationResult` type/interface with a discriminated union. Preserve all existing PDF result fields exactly — add only the discriminator and new variant:

```typescript
import type { JobRelevanceResult } from '../../job-relevance/interfaces/job-relevance.interface';

// Replace existing ResumeGenerationResult with:
export type ResumeGenerationResult =
  | ({
      kind: 'pdf';
      relevance?: JobRelevanceResult;
    } & ExistingPdfResultFields)   // ← keep every field that was here before
  | {
      kind: 'low_fit_warning';
      relevance: JobRelevanceResult;
    };
```

> **Important:** After adding this union, narrow on `result.kind === 'pdf'` at every existing consumer of `ResumeGenerationResult` — the controller and the batch processor. The compiler will surface each one; fix them inline.

- [ ] **Step 6: Lint + build**

```bash
npm run lint && npm run build
```

Fix any narrowing errors the type union surfaces (add `if (result.kind !== 'pdf') return;` guards at call sites). Re-run until clean.

---

## Task 9 — Orchestrator: speculative parallel pre-flight

**path:** `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts`
**intent:** Inject `JobRelevanceService`. Fire relevance check and the tailoring pipeline concurrently via a shared `AbortController`. If relevance resolves as `low` before the user acknowledged it, abort the tailor and return `{ kind: 'low_fit_warning' }`. All other paths return `{ kind: 'pdf' }` as before. Persist relevance result onto the saved generation row.
**verify:** `npm run lint && npm run build` clean; manual smoke test with known-mismatched JD returns JSON warning body.
**agency:** Backend Architect (`@agency-backend-architect.mdc`)
**docs:** `docs/ERROR-HANDLING.md`, `docs/API-PATTERNS.md`, existing orchestrator source

**Files:**
- Modify: `src/modules/resume-tailoring/services/resume-generation-orchestrator.service.ts`

- [ ] **Step 1: Add import and inject `JobRelevanceService`**

At the top of the file, add:

```typescript
import { JobRelevanceService } from '../../job-relevance/job-relevance.service';
import { JobRelevanceVerdict } from '../../job-relevance/enums/job-relevance-verdict.enum';
import { JobRelevanceEngine } from '../../job-relevance/enums/job-relevance-engine.enum';
import type { JobRelevanceResult } from '../../job-relevance/interfaces/job-relevance.interface';
import type {
  JobRelevanceInput,
  JobRelevanceProfileSource,
} from '../../job-relevance/interfaces/job-relevance-input.interface';
```

In the constructor, add:

```typescript
private readonly jobRelevanceService: JobRelevanceService,
```

- [ ] **Step 2: Add profile-source resolver helper**

Add a private method below the constructor:

```typescript
private async resolveRelevanceProfile(
  input: ResumeGenerationInput,
): Promise<JobRelevanceProfileSource> {
  if (input.userContext?.userId && !input.resumeFile) {
    const enriched = await this.resumeContentService.getEnrichedProfile(
      input.userContext.userId,
    );
    if (enriched) {
      return {
        kind: 'enriched',
        profileVersion: enriched.version,
        content: enriched.enrichedContent,
      };
    }
  }
  return { kind: 'none' };
}
```

> If `ResumeContentService` does not yet expose `getEnrichedProfile(userId)`, add it as a single TypeORM query:
> `return this.enrichedResumeProfileRepository.findOne({ where: { userId }, order: { version: 'DESC' } });`
> Keep it in `ResumeContentService` to avoid a new dependency injection chain.

- [ ] **Step 3: Add abort helper**

```typescript
private throwIfAborted(signal: AbortSignal, context: string): void {
  if (signal.aborted) {
    const err = new Error(`Tailor pipeline aborted at: ${context}`);
    err.name = 'AbortError';
    throw err;
  }
}
```

- [ ] **Step 4: Extract existing pipeline body into `runTailoringPipeline`**

Move the entire current body of `generateOptimizedResume` (validation, analysis, optimization, scoring, PDF, persistence) into a new private method:

```typescript
private async runTailoringPipeline(
  input: ResumeGenerationInput,
  signal: AbortSignal,
): Promise<{ pdfResult: Buffer; savedGeneration: ResumeGeneration }> {
  this.throwIfAborted(signal, 'pre-validation');

  const validationTime = await this.runValidation(input);
  this.throwIfAborted(signal, 'post-validation');

  const { jobAnalysis, resumeContent, parallelOperationsTime } =
    await this.runAnalysisAndProcessing(input);
  this.throwIfAborted(signal, 'post-analysis');

  const { optimizationResult, optimizationTime } =
    await this.runOptimization(input, jobAnalysis, resumeContent);
  this.throwIfAborted(signal, 'post-optimization');

  // ... rest of the existing pipeline steps, each preceded by throwIfAborted ...
  // keep all existing variable names and logic exactly as they are today
  // just pass `signal` through and call throwIfAborted between each awaited step

  return { pdfResult, savedGeneration };
}
```

> Carry `validationTime`, `parallelOperationsTime`, `optimizationTime`, and all existing timing/logging variables through unchanged.

- [ ] **Step 5: Rewrite `generateOptimizedResume` to use speculative parallel**

Replace the body of `generateOptimizedResume` with:

```typescript
async generateOptimizedResume(
  input: ResumeGenerationInput,
): Promise<ResumeGenerationResult> {
  const startTime = Date.now();
  this.logger.log(
    `Starting resume generation for ${input.jobPosition} at ${input.companyName}`,
  );

  if (!input.resumeFile) {
    await this.assertProfileReady(input.userContext.userId);
  }

  const abortController = new AbortController();

  const relevancePromise = this.resolveRelevanceProfile(input).then((profile) =>
    this.jobRelevanceService.score({
      userId: input.userContext?.userId ?? null,
      profile,
      jobPosition: input.jobPosition,
      companyName: input.companyName,
      jobDescription: input.jobDescription,
      abortSignal: abortController.signal,
    }),
  );

  const tailorPromise = this.runTailoringPipeline(
    input,
    abortController.signal,
  ).catch((err: Error) => {
    if (err.name === 'AbortError') return null;
    throw err;
  });

  const relevance = await relevancePromise;

  const isLowFit =
    relevance.verdict === JobRelevanceVerdict.LOW && !input.acknowledgeLowFit;

  if (isLowFit) {
    abortController.abort();
    await tailorPromise;
    this.logger.log(
      `[JobRelevance] Aborted tailor — score=${relevance.score} verdict=${relevance.verdict} ack=false`,
    );
    return { kind: 'low_fit_warning', relevance };
  }

  const tailorOutcome = await tailorPromise;

  if (!tailorOutcome) {
    throw new InternalServerErrorException(
      'Tailor pipeline produced no result after relevance check passed',
      ERROR_CODES.RESUME_GENERATION_FAILED,
    );
  }

  await this.resumeGenerationRepository.update(
    { id: tailorOutcome.savedGeneration.id },
    {
      preGenerationRelevance: {
        ...relevance,
        acknowledgedLowFit: !!input.acknowledgeLowFit,
      },
    },
  );

  this.logger.log(
    `Resume generation completed in ${Date.now() - startTime}ms — relevance score=${relevance.score} engine=${relevance.engine}`,
  );

  return {
    kind: 'pdf',
    relevance,
    ...tailorOutcome.pdfResult,
  };
}
```

- [ ] **Step 6: Lint + build**

```bash
npm run lint && npm run build
```

Fix any type errors (narrowing on `ResumeGenerationResult.kind` at consumers). Re-run until clean.

---

## Task 10 — Controller: PDF vs JSON discriminator on `/generate`

**path:** `src/modules/resume-tailoring/resume-tailoring.controller.ts`
**intent:** After calling `generateOptimizedResume`, branch on `result.kind`. PDF path streams the buffer as before and adds `X-Relevance-*` headers from constants. Low-fit path sets `Content-Type: application/json` and returns the structured warning envelope using `RESPONSE_TYPES` constant — no inline strings.
**verify:** `npm run lint && npm run build` clean; manual `curl` smoke test with mismatched JD returns `{"type":"low_fit_warning",...}`.
**agency:** Senior Developer (`@agency-senior-developer.mdc`)
**docs:** `docs/API-PATTERNS.md` §Response semantics; existing `setPdfResponseHeaders` for header pattern

**Files:**
- Modify: `src/modules/resume-tailoring/resume-tailoring.controller.ts`

- [ ] **Step 1: Add import**

```typescript
import { JOB_RELEVANCE_CONSTANTS } from '../job-relevance/constants/job-relevance.constants';
import { JobRelevanceEngine } from '../job-relevance/enums/job-relevance-engine.enum';
```

- [ ] **Step 2: Pass `acknowledgeLowFit` into orchestrator call**

Locate the `generateOptimizedResume({...})` call in the generate handler. Add:

```typescript
acknowledgeLowFit: dto.acknowledgeLowFit ?? false,
```

to the input object.

- [ ] **Step 3: Branch on result kind**

Replace the current response-building block after the `generateOptimizedResume` call with:

```typescript
if (result.kind === 'low_fit_warning') {
  res.setHeader(
    JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_SCORE,
    String(result.relevance.score),
  );
  res.setHeader(
    JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_VERDICT,
    result.relevance.verdict,
  );
  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    type: JOB_RELEVANCE_CONSTANTS.RESPONSE_TYPES.LOW_FIT_WARNING,
    relevance: result.relevance,
  });
}

// PDF path — add relevance headers then existing PDF streaming logic
res.setHeader(
  JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_SCORE,
  String(result.relevance?.score ?? ''),
);
res.setHeader(
  JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_VERDICT,
  result.relevance?.verdict ?? '',
);
res.setHeader(
  JOB_RELEVANCE_CONSTANTS.HEADERS.RELEVANCE_CACHE_HIT,
  String(result.relevance?.engine === JobRelevanceEngine.CACHE_HIT),
);
// ... existing setPdfResponseHeaders + res.end(pdfBuffer) unchanged ...
```

- [ ] **Step 4: Lint + build**

```bash
npm run lint && npm run build
```

Expected: zero errors.

- [ ] **Step 5: Manual smoke test**

```bash
JOB_RELEVANCE_GATE_ENABLED=true npm run start:dev
# in another terminal:
curl -s -X POST http://localhost:3000/resume-tailoring/generate \
  -F "resumeFile=@./test-fixtures/angular-node-resume.pdf" \
  -F "jobPosition=React Engineer" \
  -F "companyName=Acme Corp" \
  -F 'jobDescription=Senior React + .NET full-stack engineer required. Must have Entity Framework experience.' \
  -F "templateId=<any-valid-template-uuid>" | jq .type
```

Expected output: `"low_fit_warning"`.

---

## Task 11 — Batch v2: sync pre-flight before enqueue

**path:** `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts`, `src/modules/resume-tailoring/resume-tailoring.controller.ts`
**intent:** Score all batch jobs concurrently before any worker enqueue. If any job has `verdict=low` and no acknowledgement, return `200 batch_low_fit_warning` with per-job results using `RESPONSE_TYPES` constant. Otherwise continue to existing 202 path.
**verify:** `npm run lint && npm run build` clean; manual smoke test with mixed-fit batch returns `{"type":"batch_low_fit_warning",...}`.
**agency:** Backend Architect (`@agency-backend-architect.mdc`)
**docs:** `docs/API-PATTERNS.md` §Async Long-Running Operation Pattern, existing `batch-tailoring-v2.service.ts`

**Files:**
- Modify: `src/modules/resume-tailoring/batch-tailoring-v2/batch-tailoring-v2.service.ts`
- Modify: `src/modules/resume-tailoring/resume-tailoring.controller.ts`

- [ ] **Step 1: Add imports and inject `JobRelevanceService`**

In `batch-tailoring-v2.service.ts`, add:

```typescript
import { JobRelevanceService } from '../../job-relevance/job-relevance.service';
import { JobRelevanceVerdict } from '../../job-relevance/enums/job-relevance-verdict.enum';
import type { JobRelevanceResult } from '../../job-relevance/interfaces/job-relevance.interface';
import type { JobRelevanceProfileSource } from '../../job-relevance/interfaces/job-relevance-input.interface';
```

Add to constructor: `private readonly jobRelevanceService: JobRelevanceService`.

- [ ] **Step 2: Add profile-source resolver**

```typescript
private async resolveRelevanceProfile(
  userId: string,
): Promise<JobRelevanceProfileSource> {
  const enriched = await this.resumeContentService.getEnrichedProfile(userId);
  if (enriched) {
    return {
      kind: 'enriched',
      profileVersion: enriched.version,
      content: enriched.enrichedContent,
    };
  }
  return { kind: 'none' };
}
```

- [ ] **Step 3: Add pre-flight method**

```typescript
private async runPreflightRelevance(
  userId: string,
  jobs: BatchGenerateJob[],
): Promise<JobRelevanceResult[]> {
  const profile = await this.resolveRelevanceProfile(userId);
  return Promise.all(
    jobs.map((job) =>
      this.jobRelevanceService.score({
        userId,
        profile,
        jobPosition: job.jobPosition,
        companyName: job.companyName,
        jobDescription: job.jobDescription,
      }),
    ),
  );
}
```

- [ ] **Step 4: Wrap `enqueueBatch` with pre-flight**

Update the return type of `enqueueBatch` to a discriminated union, then add the pre-flight guard at the top of the method body:

```typescript
async enqueueBatch(
  dto: BatchGenerateDto,
  userId: string,
): Promise<
  | { kind: 'enqueued'; batchId: string; totalJobs: number }
  | { kind: 'low_fit_warning'; jobs: Array<{ jobIndex: number; relevance: JobRelevanceResult }> }
> {
  if (!dto.acknowledgeLowFit) {
    const relevances = await this.runPreflightRelevance(userId, dto.jobs);
    const hasLowFit = relevances.some(
      (r) => r.verdict === JobRelevanceVerdict.LOW,
    );
    if (hasLowFit) {
      return {
        kind: 'low_fit_warning',
        jobs: relevances.map((relevance, jobIndex) => ({ jobIndex, relevance })),
      };
    }
  }

  // existing enqueue logic unchanged below this point
  // ...
  return { kind: 'enqueued', batchId, totalJobs };
}
```

- [ ] **Step 5: Update controller batch v2 handler**

In `resume-tailoring.controller.ts`, locate the `POST /resume-tailoring/batch/v2/generate` handler. Replace the response block:

```typescript
const result = await this.batchTailoringV2Service.enqueueBatch(dto, req.user.id);

if (result.kind === 'low_fit_warning') {
  return res.status(200).json({
    type: JOB_RELEVANCE_CONSTANTS.RESPONSE_TYPES.BATCH_LOW_FIT_WARNING,
    jobs: result.jobs,
  });
}

return res.status(202).json({
  batchId: result.batchId,
  totalJobs: result.totalJobs,
});
```

- [ ] **Step 6: Lint + build**

```bash
npm run lint && npm run build
```

Expected: zero errors.

- [ ] **Step 7: Manual smoke test**

```bash
curl -s -X POST http://localhost:3000/resume-tailoring/batch/v2/generate \
  -H "Authorization: Bearer <valid-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "<valid-template-id>",
    "jobs": [
      { "jobPosition": "React Engineer", "companyName": "Acme", "jobDescription": "React + .NET required" },
      { "jobPosition": "Node Engineer",  "companyName": "Beta", "jobDescription": "Node + Express, proven track record" }
    ]
  }' | jq .type
```

Expected: `"batch_low_fit_warning"` (assuming LLM classifies Angular/Node resume as low-fit for the React+.NET role).

---

## Task 12 — Env config + spec update

**path:** `.env.example`, `docs/specs/03-resume-tailoring.md`
**intent:** Document the kill-switch and any threshold variables so operators know what to flip.
**verify:** `npm run lint && npm run build` clean; `JOB_RELEVANCE_GATE_ENABLED=false npm run start:dev` boots and logs show `engine=skipped` for all generations (no LLM calls).
**agency:** DevOps Automator (`@agency-devops-automator.mdc`)
**docs:** `docs/SECURITY.md`, `.env.example` (existing format reference)

**Files:**
- Modify: `.env.example`
- Modify: `docs/specs/03-resume-tailoring.md`

- [ ] **Step 1: Add to `.env.example`**

```bash
# Job relevance gate — pre-generation fit check (set to false to disable entirely)
JOB_RELEVANCE_GATE_ENABLED=true
```

- [ ] **Step 2: Add spec subsection to `docs/specs/03-resume-tailoring.md`**

Under the "Generate tailored resume (single)" section, add:

```markdown
### Pre-generation relevance gate

When `JOB_RELEVANCE_GATE_ENABLED=true`, `POST /resume-tailoring/generate` runs a
Haiku 4.5 job-fit check **in parallel** with the tailoring pipeline. If the score
verdict is `low` and `acknowledgeLowFit` was not `true`, the tailoring pipeline is
aborted and the response is:

- **HTTP 200** with `Content-Type: application/json`
- Body: `{ "type": "low_fit_warning", "relevance": { score, verdict, dimensions, gaps, strengths, ... } }`

To force generation regardless of score, resubmit with `acknowledgeLowFit: true`. The
relevance result is persisted on the `resume_generations.pre_generation_relevance`
column in all cases.

The same pre-flight logic applies to `POST /resume-tailoring/batch/v2/generate`:
all jobs are scored synchronously before enqueueing. Any low-fit job returns:

- **HTTP 200** with `{ "type": "batch_low_fit_warning", "jobs": [...per-job verdicts] }`

Set `acknowledgeLowFit: true` in the batch body to bypass the gate.

Kill-switch: set `JOB_RELEVANCE_GATE_ENABLED=false` to disable globally (engine returns `skipped`, score=100, no LLM call fires).
```

- [ ] **Step 3: Kill-switch smoke test**

```bash
JOB_RELEVANCE_GATE_ENABLED=false npm run start:dev
# In another terminal — hit /generate, check logs:
grep "engine=skipped" <log output>
```

Expected: every generation log shows `engine=skipped`.

- [ ] **Step 4: Lint + build**

```bash
npm run lint && npm run build
```

---

## Task 13 — Final lint, build, and Code Reviewer pass

**path:** repo-wide
**intent:** Confirm nothing else broke; independent code review before merge.
**verify:** `npm run lint` zero errors, `npm run build` zero errors.
**agency:** Code Reviewer (`@agency-code-reviewer.mdc`)
**docs:** `docs/CONVENTIONS.md`, `docs/SECURITY.md`, `docs/API-PATTERNS.md`, `docs/ERROR-HANDLING.md`

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: zero errors.

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: zero errors.

- [ ] **Step 3: Dispatch Code Reviewer**

Use the Code Reviewer agent (`subagentType: Code Reviewer`) with this brief:

> Review all changes introduced for the `job-relevance` feature. Focus areas:
> 1. **Abort-signal propagation** — are orphan promises possible after `abortController.abort()`?
> 2. **Race condition** — if the tailor pipeline finishes before relevance resolves, is the abort path safe?
> 3. **No magic strings** — confirm all string literals in service/controller/DTO files come from `JOB_RELEVANCE_CONSTANTS` or enums. Flag any remaining hardcoded strings.
> 4. **Kill-switch off** — confirm zero LLM construction and zero Redis calls when `SKIPPED`.
> 5. **PII in logs** — confirm JD text never appears in `logger.log/warn` calls.
> 6. **forwardRef circular module** — confirm both sides use `forwardRef`; no circular import at compile time.
>
> Report blockers and non-blockers separately.

- [ ] **Step 4: Address blockers**

For each blocker, fix inline and re-run:

```bash
npm run lint && npm run build
```

---

## Appendix A — Failure-mode reference

| Failure | Engine value | Response shape | User impact |
|---------|--------------|----------------|-------------|
| Redis down | `llm` or fast-path | Normal — cache skipped | None |
| LLM timeout (>1.5s) | `timeout` | Verdict forced `medium`, score=0 → treated as pass; PDF returned | No modal |
| LLM 5xx | `fallback` | Same as timeout | No modal |
| Profile missing / profile.kind = none | `skipped` | PDF returned | No modal |
| Kill-switch off | `skipped` | PDF returned | No modal |
| Tailor aborted mid-stream (low-fit) | n/a | `low_fit_warning` JSON 200 | Modal shown |
| Tailor fails after relevance passed | existing 5xx path | 5xx | Same as today |

## Appendix B — Frontend contract (out of scope for this plan)

The frontend repo must implement the following to complete the feature:

1. **Response discriminator** — detect `Content-Type: application/json` on `POST /resume-tailoring/generate` (today always `application/pdf`). Parse `response.body.type`. If `low_fit_warning` → render modal.

2. **Single-generate modal (Layout B):**
   - Score badge (48px circle, verdict color token)
   - 3 dimension bars: `techStack`, `roleType`, `experienceLevel` — animate `width: 0 → target` over 400ms ease-out on mount; obey `prefers-reduced-motion`
   - Gap bullets (max 4) and strength bullets (max 3)
   - Two buttons: `Cancel` (closes modal, resets form state) and `Generate anyway` (resubmits same payload with `acknowledgeLowFit: true`)

3. **Batch v2 modal** — detect `{ type: 'batch_low_fit_warning' }` on the batch endpoint 200 response (today always 202). Render per-job cards with same dimension component. Three buttons: `Generate all`, `Generate only high-fit` (drops `low` jobs from payload), `Cancel`.

4. **2026 design language (must match existing app theme):**
   - Modal surface: `backdrop-filter: blur(20px)` with theme accent border at low alpha (translucent glass)
   - Entrance: fade + slide-up, 200ms ease-out
   - Score number: display font, 96–120px, verdict color
   - Verdict color tokens: `--color-verdict-low` (danger), `--color-verdict-medium` (warning), `--color-verdict-high` (success) — map to existing semantic token names in the design system
   - Focus ring: 2px solid theme accent, 2px offset (existing global focus style)
   - Close button: top-right `×`, 44×44px minimum hit target
   - Body copy: 14px regular for bullets, 16px medium for headline

## Appendix C — Operational rollout

1. Deploy with `JOB_RELEVANCE_GATE_ENABLED=false` (default off in prod). Confirm logs show `engine=skipped`.
2. Enable on staging. Smoke test with curated low-fit and high-fit JDs.
3. Enable for a small prod cohort (env-per-pod or feature-flag wrapper) for 48h. Watch:
   - p95 latency on `/generate` — target <5% regression on high-fit path (parallel hides relevance cost).
   - Low-fit modal trigger rate (% of requests returning `low_fit_warning`).
   - Ack-through rate (% of low-fit warnings where user resubmitted with `acknowledgeLowFit: true`).
   - Haiku spend per day.
4. If healthy, enable globally and coordinate frontend UX launch.
