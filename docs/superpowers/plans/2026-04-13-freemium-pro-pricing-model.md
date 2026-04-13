# Freemium + Pro Pricing Model Implementation Plan

> **For agentic workers:** Dispatch each task using the Agency specialist agent below. Use `subagent_type: "engineering-backend-architect"` for all implementation tasks and `subagent_type: "testing-api-tester"` for test-only tasks. Follow the superpowers:subagent-driven-development skill for transport (fresh context, two-stage review, status handling).

**Goal:** Replace the old three-plan seed data and misaligned rate limit configs with a clean Freemium + Pro two-tier pricing model, enforcing all per-plan limits in the backend.

**Architecture:** Two new files are introduced (`plan-limits.constants.ts` and `resume-history.model.ts`) alongside changes to six existing files. The `BillingCycle` enum loses `WEEKLY`, seed data is rewritten with two Pro plans, the rate limit service gains full coverage for all gated features, the history service enforces a configurable lookback for FREEMIUM users using a model class for mapping, and the batch route is gated behind `PremiumUserGuard`. No database migrations — pre-launch with no real subscribers.

**Tech Stack:** NestJS, TypeORM, Jest, TypeScript

**Design spec:** `docs/superpowers/specs/2026-04-13-freemium-pro-pricing-model-design.md`

> **Commit policy:** Do NOT commit after individual tasks. All changes are staged and reviewed by the user at the end before any commit or push.

---

## File Map

| File | Create / Modify |
|------|----------------|
| `src/shared/constants/plan-limits.constants.ts` | **Create** — configurable plan limit values |
| `src/modules/resume-tailoring/models/resume-history.model.ts` | **Create** — `ResumeHistoryItem`, `ResumeHistoryDetail`, `PaginatedResumeHistory` |
| `src/modules/subscription/enums/billing-cycle.enum.ts` | Modify — remove `WEEKLY` |
| `src/scripts/seed/seed-subscription-plans.ts` | Modify — replace 3 old plans with Pro Monthly + Pro Annual |
| `src/scripts/seed/seed-subscription-plans-service.ts` | Modify — same replacement |
| `src/modules/rate-limit/rate-limit.service.ts` | Modify — rewrite `initializeRateLimitConfigs()`; expand `getUserUsageStats()` and `getFormattedFeatureUsage()` using `FeatureType` enum values |
| `src/modules/resume-tailoring/services/resume.service.ts` | Modify — use constant + model class in both history methods; remove old inline interfaces |
| `src/modules/resume-tailoring/resume-tailoring.controller.ts` | Modify — pass `plan` to history calls; add `PremiumUserGuard` + uncomment `@RateLimitFeature` on batch route |

---

## Task 1: Remove `WEEKLY` from BillingCycle enum

**Files:**
- Modify: `src/modules/subscription/enums/billing-cycle.enum.ts`

No test needed — TypeScript compilation validates that no code references the removed value.

- [ ] **Step 1: Remove `WEEKLY` from the enum**

Replace the entire file:

```typescript
/**
 * Billing Cycle Enum
 *
 * Defines the available billing cycles for subscription plans
 */
export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}
```

- [ ] **Step 2: Verify no remaining references**

```bash
grep -r "BillingCycle.WEEKLY\|WEEKLY" src/ --include="*.ts"
```

Expected: no output (zero matches).

- [ ] **Step 3: Build to confirm no type errors**

```bash
npm run build
```

Expected: build succeeds with no errors.

---

## Task 2: Replace subscription plan seed data

**Files:**
- Modify: `src/scripts/seed/seed-subscription-plans.ts`
- Modify: `src/scripts/seed/seed-subscription-plans-service.ts`

Both files contain the same plan array. Both are replaced with the two Pro plans. Lemon Squeezy variant IDs are placeholder strings to be swapped before launch.

- [ ] **Step 1: Rewrite `seed-subscription-plans.ts`**

Replace the entire file:

```typescript
import { DataSource } from 'typeorm';
import { BillingCycle } from '../../modules/subscription/enums';
import { Currency } from '../../modules/subscription/enums/payment.enum';
import { SubscriptionPlan } from '../../database/entities';

export async function seedSubscriptionPlans(dataSource: DataSource) {
  const repo = dataSource.getRepository(SubscriptionPlan);

  const existingPlansCount = await repo.count();
  if (existingPlansCount > 0) {
    console.log('Subscription plans already exist. Skipping seeding.');
    return;
  }

  const subscriptionPlans = [
    {
      plan_name: 'Pro Monthly',
      description:
        'Full access for active job seekers. Tailor up to 30 resumes and generate 15 cover letters per month, with batch generation and all premium templates.',
      price: 12.0,
      currency: Currency.USD,
      payment_gateway_variant_id: 'PLACEHOLDER_MONTHLY_VARIANT_ID',
      billing_cycle: BillingCycle.MONTHLY,
      is_active: true,
      features: [
        '30 tailored resumes per month',
        '15 cover letters per month',
        'Batch generation (up to 3 jobs/batch, 10 batches/month)',
        'All resume templates',
        'Unlimited job application tracking',
        'Full generation history',
        'Priority support',
      ],
    },
    {
      plan_name: 'Pro Annual',
      description:
        'Everything in Pro Monthly at 38% off. Best value for a committed job search.',
      price: 89.0,
      currency: Currency.USD,
      payment_gateway_variant_id: 'PLACEHOLDER_ANNUAL_VARIANT_ID',
      billing_cycle: BillingCycle.YEARLY,
      is_active: true,
      features: [
        '30 tailored resumes per month',
        '15 cover letters per month',
        'Batch generation (up to 3 jobs/batch, 10 batches/month)',
        'All resume templates',
        'Unlimited job application tracking',
        'Full generation history',
        'Priority support',
        'Best value — save 38%',
      ],
    },
  ];

  for (const planData of subscriptionPlans) {
    const plan = repo.create(planData);
    await repo.save(plan);
    console.log(
      `Seeded subscription plan: ${planData.plan_name} - $${planData.price}`,
    );
  }

  console.log('All subscription plans seeded successfully.');
}
```

- [ ] **Step 2: Rewrite `seed-subscription-plans-service.ts`**

Replace the entire file:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { SubscriptionPlanService } from '../../modules/subscription/services/subscription-plan.service';
import { Logger } from '@nestjs/common';
import { BillingCycle } from '../../modules/subscription/enums';
import { Currency } from '../../modules/subscription/enums/payment.enum';

async function seedSubscriptionPlans() {
  const logger = new Logger('SeedSubscriptionPlans');

  try {
    logger.log('Starting subscription plans seeding...');

    const app = await NestFactory.createApplicationContext(AppModule);
    const subscriptionPlanService = app.get(SubscriptionPlanService);

    const existingPlans = await subscriptionPlanService.findAll();
    if (existingPlans.length > 0) {
      logger.log('Subscription plans already exist. Skipping seeding.');
      await app.close();
      return;
    }

    const subscriptionPlans = [
      {
        plan_name: 'Pro Monthly',
        description:
          'Full access for active job seekers. Tailor up to 30 resumes and generate 15 cover letters per month, with batch generation and all premium templates.',
        price: 12.0,
        currency: Currency.USD,
        payment_gateway_variant_id: 'PLACEHOLDER_MONTHLY_VARIANT_ID',
        billing_cycle: BillingCycle.MONTHLY,
        is_active: true,
        features: [
          '30 tailored resumes per month',
          '15 cover letters per month',
          'Batch generation (up to 3 jobs/batch, 10 batches/month)',
          'All resume templates',
          'Unlimited job application tracking',
          'Full generation history',
          'Priority support',
        ],
      },
      {
        plan_name: 'Pro Annual',
        description:
          'Everything in Pro Monthly at 38% off. Best value for a committed job search.',
        price: 89.0,
        currency: Currency.USD,
        payment_gateway_variant_id: 'PLACEHOLDER_ANNUAL_VARIANT_ID',
        billing_cycle: BillingCycle.YEARLY,
        is_active: true,
        features: [
          '30 tailored resumes per month',
          '15 cover letters per month',
          'Batch generation (up to 3 jobs/batch, 10 batches/month)',
          'All resume templates',
          'Unlimited job application tracking',
          'Full generation history',
          'Priority support',
          'Best value — save 38%',
        ],
      },
    ];

    for (const planData of subscriptionPlans) {
      await subscriptionPlanService.create(planData);
      logger.log(
        `Seeded subscription plan: ${planData.plan_name} - $${planData.price}`,
      );
    }

    logger.log('All subscription plans seeded successfully!');
    await app.close();
  } catch (error) {
    logger.error('Error seeding subscription plans:', error);
    process.exit(1);
  }
}

void seedSubscriptionPlans();
```

---

## Task 3: Rewrite `initializeRateLimitConfigs()` with complete new config set

**Files:**
- Modify: `src/modules/rate-limit/rate-limit.service.ts` — `initializeRateLimitConfigs` method only
- Create: `src/modules/rate-limit/rate-limit.service.spec.ts`

- [ ] **Step 1: Write a failing test**

Create `src/modules/rate-limit/rate-limit.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RateLimitService } from './rate-limit.service';
import { UsageTracking, FeatureType } from '../../database/entities/usage-tracking.entity';
import { RateLimitConfig } from '../../database/entities/rate-limit-config.entity';
import { UserPlan, UserType } from '../../database/entities/user.entity';

describe('RateLimitService.initializeRateLimitConfigs', () => {
  let service: RateLimitService;
  let savedConfigs: any[];

  const mockRateLimitConfigRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockImplementation((config) => {
      savedConfigs.push(config);
      return Promise.resolve(config);
    }),
  };

  const mockUsageTrackingRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  beforeEach(async () => {
    savedConfigs = [];
    jest.clearAllMocks();
    mockRateLimitConfigRepo.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        {
          provide: getRepositoryToken(UsageTracking),
          useValue: mockUsageTrackingRepo,
        },
        {
          provide: getRepositoryToken(RateLimitConfig),
          useValue: mockRateLimitConfigRepo,
        },
      ],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  it('saves exactly 5 rate limit configs', async () => {
    await service.initializeRateLimitConfigs();
    expect(savedConfigs).toHaveLength(5);
  });

  it('sets FREEMIUM resume_generation limit to 3', async () => {
    await service.initializeRateLimitConfigs();
    const config = savedConfigs.find(
      (c) =>
        c.plan === UserPlan.FREEMIUM &&
        c.feature_type === FeatureType.RESUME_GENERATION,
    );
    expect(config).toBeDefined();
    expect(config.monthly_limit).toBe(3);
    expect(config.user_type).toBe(UserType.REGISTERED);
  });

  it('sets FREEMIUM cover_letter limit to 1', async () => {
    await service.initializeRateLimitConfigs();
    const config = savedConfigs.find(
      (c) =>
        c.plan === UserPlan.FREEMIUM &&
        c.feature_type === FeatureType.COVER_LETTER,
    );
    expect(config).toBeDefined();
    expect(config.monthly_limit).toBe(1);
  });

  it('sets PREMIUM resume_generation limit to 30', async () => {
    await service.initializeRateLimitConfigs();
    const config = savedConfigs.find(
      (c) =>
        c.plan === UserPlan.PREMIUM &&
        c.feature_type === FeatureType.RESUME_GENERATION,
    );
    expect(config).toBeDefined();
    expect(config.monthly_limit).toBe(30);
  });

  it('sets PREMIUM cover_letter limit to 15', async () => {
    await service.initializeRateLimitConfigs();
    const config = savedConfigs.find(
      (c) =>
        c.plan === UserPlan.PREMIUM &&
        c.feature_type === FeatureType.COVER_LETTER,
    );
    expect(config).toBeDefined();
    expect(config.monthly_limit).toBe(15);
  });

  it('sets PREMIUM resume_batch_generation limit to 10', async () => {
    await service.initializeRateLimitConfigs();
    const config = savedConfigs.find(
      (c) =>
        c.plan === UserPlan.PREMIUM &&
        c.feature_type === FeatureType.RESUME_BATCH_GENERATION,
    );
    expect(config).toBeDefined();
    expect(config.monthly_limit).toBe(10);
  });

  it('does NOT include FREEMIUM resume_batch_generation config', async () => {
    await service.initializeRateLimitConfigs();
    const config = savedConfigs.find(
      (c) =>
        c.plan === UserPlan.FREEMIUM &&
        c.feature_type === FeatureType.RESUME_BATCH_GENERATION,
    );
    expect(config).toBeUndefined();
  });

  it('skips saving a config that already exists', async () => {
    mockRateLimitConfigRepo.findOne.mockResolvedValueOnce({ id: 'exists' });
    await service.initializeRateLimitConfigs();
    expect(savedConfigs).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="rate-limit.service.spec" --no-coverage
```

Expected: FAIL — current method has wrong limits (5, 50, 25) and is missing `COVER_LETTER` configs.

- [ ] **Step 3: Rewrite `initializeRateLimitConfigs()` in `rate-limit.service.ts`**

Replace the entire method (currently lines 288–329):

```typescript
  /**
   * Initialize rate limit configurations if they don't exist.
   * Freemium + Pro two-tier model:
   *   Free: 3 resume generations, 1 cover letter per month
   *   Pro:  30 resume generations, 15 cover letters, 10 batch generation runs per month
   *
   * No FREEMIUM batch generation row — batch is blocked at the route level
   * by PremiumUserGuard before the rate limit guard runs.
   */
  async initializeRateLimitConfigs(): Promise<void> {
    const configs = [
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_GENERATION,
        monthly_limit: 3,
        description: 'Free plan: 3 tailored resume generations per month',
      },
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.COVER_LETTER,
        monthly_limit: 1,
        description: 'Free plan: 1 cover letter per month',
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_GENERATION,
        monthly_limit: 30,
        description: 'Pro plan: 30 tailored resume generations per month',
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.COVER_LETTER,
        monthly_limit: 15,
        description: 'Pro plan: 15 cover letters per month',
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_BATCH_GENERATION,
        monthly_limit: 10,
        description: 'Pro plan: 10 batch generation runs per month',
      },
    ];

    for (const config of configs) {
      const existing = await this.rateLimitConfigRepository.findOne({
        where: {
          plan: config.plan,
          user_type: config.user_type,
          feature_type: config.feature_type,
        },
      });

      if (!existing) {
        await this.rateLimitConfigRepository.save(config);
        this.logger.log(`Created rate limit config: ${config.description}`);
      }
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="rate-limit.service.spec" --no-coverage
```

Expected: all 8 tests PASS.

---

## Task 4: Expand `getUserUsageStats()` and `getFormattedFeatureUsage()` — use `FeatureType` enum, no hardcoded strings

**Files:**
- Modify: `src/modules/rate-limit/rate-limit.service.ts` — two methods
- Modify: `src/modules/rate-limit/rate-limit.service.spec.ts` — append new describe block

Both methods currently only surface `resume_generation` as a hardcoded string. They are expanded to include `cover_letter` and (for PREMIUM) `resume_batch_generation`, using `FeatureType` enum values throughout — no bare string literals.

- [ ] **Step 1: Write failing tests — append to `rate-limit.service.spec.ts`**

Add the following `describe` block at the bottom of the existing spec file:

```typescript
describe('RateLimitService — getUserUsageStats and getFormattedFeatureUsage', () => {
  let service: RateLimitService;

  const mockRateLimitConfigRepo = {
    findOne: jest.fn().mockImplementation(({ where }) => {
      const limits: Record<string, number> = {
        [`${UserPlan.FREEMIUM}:${FeatureType.RESUME_GENERATION}`]: 3,
        [`${UserPlan.FREEMIUM}:${FeatureType.COVER_LETTER}`]: 1,
        [`${UserPlan.PREMIUM}:${FeatureType.RESUME_GENERATION}`]: 30,
        [`${UserPlan.PREMIUM}:${FeatureType.COVER_LETTER}`]: 15,
        [`${UserPlan.PREMIUM}:${FeatureType.RESUME_BATCH_GENERATION}`]: 10,
      };
      const key = `${where.plan}:${where.feature_type}`;
      const limit = limits[key];
      return Promise.resolve(
        limit ? { monthly_limit: limit, is_active: true } : null,
      );
    }),
    save: jest.fn(),
  };

  const mockUsageTrackingRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(),
    create: jest.fn().mockImplementation((v) => v),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        {
          provide: getRepositoryToken(UsageTracking),
          useValue: mockUsageTrackingRepo,
        },
        {
          provide: getRepositoryToken(RateLimitConfig),
          useValue: mockRateLimitConfigRepo,
        },
      ],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  const freemiumContext = {
    userId: 'user-free',
    userType: UserType.REGISTERED,
    plan: UserPlan.FREEMIUM,
    isPremium: false,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  };

  const premiumContext = {
    ...freemiumContext,
    userId: 'user-pro',
    plan: UserPlan.PREMIUM,
    isPremium: true,
  };

  describe('getUserUsageStats', () => {
    it('returns resume_generation and cover_letter for FREEMIUM — no batch field', async () => {
      const stats = await service.getUserUsageStats(freemiumContext);
      expect(stats.resume_generation).toBeDefined();
      expect(stats.cover_letter).toBeDefined();
      expect(stats.resume_batch_generation).toBeUndefined();
    });

    it('returns all three fields for PREMIUM', async () => {
      const stats = await service.getUserUsageStats(premiumContext);
      expect(stats.resume_generation).toBeDefined();
      expect(stats.cover_letter).toBeDefined();
      expect(stats.resume_batch_generation).toBeDefined();
    });

    it('reflects correct limits for FREEMIUM', async () => {
      const stats = await service.getUserUsageStats(freemiumContext);
      expect(stats.resume_generation.limit).toBe(3);
      expect(stats.cover_letter.limit).toBe(1);
    });

    it('reflects correct limits for PREMIUM', async () => {
      const stats = await service.getUserUsageStats(premiumContext);
      expect(stats.resume_generation.limit).toBe(30);
      expect(stats.cover_letter.limit).toBe(15);
      expect(stats.resume_batch_generation!.limit).toBe(10);
    });
  });

  describe('getFormattedFeatureUsage', () => {
    it('returns 2 entries for FREEMIUM — resume_generation and cover_letter', async () => {
      const result = await service.getFormattedFeatureUsage(freemiumContext);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.feature)).toEqual([
        FeatureType.RESUME_GENERATION,
        FeatureType.COVER_LETTER,
      ]);
    });

    it('returns 3 entries for PREMIUM — resume_generation, cover_letter, resume_batch_generation', async () => {
      const result = await service.getFormattedFeatureUsage(premiumContext);
      expect(result).toHaveLength(3);
      expect(result.map((r) => r.feature)).toEqual([
        FeatureType.RESUME_GENERATION,
        FeatureType.COVER_LETTER,
        FeatureType.RESUME_BATCH_GENERATION,
      ]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="rate-limit.service.spec" --no-coverage
```

Expected: FAIL — `getUserUsageStats` currently returns only `resume_generation` and `getFormattedFeatureUsage` has 1 hardcoded string entry.

- [ ] **Step 3: Replace `getUserUsageStats()` in `rate-limit.service.ts`**

Replace the existing method (lines ~252–264):

```typescript
  /**
   * Get usage statistics for a user.
   * FREEMIUM: resume_generation + cover_letter
   * PREMIUM:  resume_generation + cover_letter + resume_batch_generation
   */
  async getUserUsageStats(userContext: UserContext): Promise<{
    resume_generation: RateLimitResult;
    cover_letter: RateLimitResult;
    resume_batch_generation?: RateLimitResult;
  }> {
    const resumeGeneration = await this.checkRateLimit(
      userContext,
      FeatureType.RESUME_GENERATION,
    );
    const coverLetter = await this.checkRateLimit(
      userContext,
      FeatureType.COVER_LETTER,
    );

    const stats: {
      resume_generation: RateLimitResult;
      cover_letter: RateLimitResult;
      resume_batch_generation?: RateLimitResult;
    } = {
      resume_generation: resumeGeneration,
      cover_letter: coverLetter,
    };

    if (userContext.plan === UserPlan.PREMIUM) {
      stats.resume_batch_generation = await this.checkRateLimit(
        userContext,
        FeatureType.RESUME_BATCH_GENERATION,
      );
    }

    return stats;
  }
```

- [ ] **Step 4: Replace `getFormattedFeatureUsage()` in `rate-limit.service.ts`**

Replace the existing method (lines ~266–284):

```typescript
  /**
   * Get formatted feature usage for the dashboard API (GET /users/feature-usage).
   * Returns 2 entries for FREEMIUM, 3 for PREMIUM.
   * Feature keys use FeatureType enum values — no hardcoded strings.
   */
  async getFormattedFeatureUsage(
    userContext: UserContext,
  ): Promise<FormattedFeatureUsage[]> {
    const stats = await this.getUserUsageStats(userContext);

    const result: FormattedFeatureUsage[] = [
      {
        feature: FeatureType.RESUME_GENERATION,
        allowed: stats.resume_generation.limit,
        remaining: stats.resume_generation.remaining,
        used: stats.resume_generation.currentUsage,
        usagePercentage: `${stats.resume_generation.usagePercentage}%`,
        resetDate: stats.resume_generation.resetDate,
      },
      {
        feature: FeatureType.COVER_LETTER,
        allowed: stats.cover_letter.limit,
        remaining: stats.cover_letter.remaining,
        used: stats.cover_letter.currentUsage,
        usagePercentage: `${stats.cover_letter.usagePercentage}%`,
        resetDate: stats.cover_letter.resetDate,
      },
    ];

    if (stats.resume_batch_generation) {
      result.push({
        feature: FeatureType.RESUME_BATCH_GENERATION,
        allowed: stats.resume_batch_generation.limit,
        remaining: stats.resume_batch_generation.remaining,
        used: stats.resume_batch_generation.currentUsage,
        usagePercentage: `${stats.resume_batch_generation.usagePercentage}%`,
        resetDate: stats.resume_batch_generation.resetDate,
      });
    }

    return result;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="rate-limit.service.spec" --no-coverage
```

Expected: all tests PASS.

---

## Task 5: Create `plan-limits.constants.ts` — configurable plan limit values

**Files:**
- Create: `src/shared/constants/plan-limits.constants.ts`

The 30-day history lookback is a business rule, not magic number. It lives in a constants file so it can be updated in one place and reused anywhere.

- [ ] **Step 1: Create the constants file**

Create `src/shared/constants/plan-limits.constants.ts`:

```typescript
/**
 * Configurable plan-level feature limits.
 *
 * Centralised here so business rules can be updated in one place
 * and reused across services without magic numbers in logic code.
 */

/**
 * Number of days of generation history visible to Free plan users.
 * Pro users see their full history with no date restriction.
 */
export const FREEMIUM_HISTORY_LOOKBACK_DAYS = 30;
```

- [ ] **Step 2: Verify the file is importable**

```bash
npm run build
```

Expected: build succeeds with no errors.

---

## Task 6: Create `ResumeHistoryItem` and `ResumeHistoryDetail` model classes

**Files:**
- Create: `src/modules/resume-tailoring/models/resume-history.model.ts`

Currently `ResumeHistoryItem` and `ResumeHistoryDetail` are plain interfaces exported from `resume.service.ts` with inline field mapping scattered in every query method. A dedicated model class centralises the mapping and makes the query methods read cleanly: `records.map((r) => new ResumeHistoryItem(r))`.

- [ ] **Step 1: Write a failing test**

Create `src/modules/resume-tailoring/models/resume-history.model.spec.ts`:

```typescript
import { ResumeHistoryItem, ResumeHistoryDetail } from './resume-history.model';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';

const makeEntity = (overrides: Partial<ResumeGeneration> = {}): ResumeGeneration =>
  ({
    id: 'gen-uuid',
    company_name: 'Acme Corp',
    job_position: 'Senior Engineer',
    optimization_confidence: 87.5,
    keywords_added: 6,
    sections_optimized: 4,
    achievements_quantified: 3,
    template_id: 'tpl-modern',
    created_at: new Date('2026-04-01T10:00:00Z'),
    pdf_s3_key: 'pdfs/gen-uuid.pdf',
    changes_diff: { added: ['TypeScript'], removed: [] },
    ...overrides,
  } as ResumeGeneration);

describe('ResumeHistoryItem', () => {
  it('maps entity fields to camelCase properties', () => {
    const item = new ResumeHistoryItem(makeEntity());
    expect(item.id).toBe('gen-uuid');
    expect(item.companyName).toBe('Acme Corp');
    expect(item.jobPosition).toBe('Senior Engineer');
    expect(item.optimizationConfidence).toBe(87.5);
    expect(item.keywordsAdded).toBe(6);
    expect(item.sectionsOptimized).toBe(4);
    expect(item.templateId).toBe('tpl-modern');
    expect(item.createdAt).toEqual(new Date('2026-04-01T10:00:00Z'));
  });

  it('sets canDownload to true when pdf_s3_key is present', () => {
    const item = new ResumeHistoryItem(makeEntity({ pdf_s3_key: 'some/key' }));
    expect(item.canDownload).toBe(true);
  });

  it('sets canDownload to false when pdf_s3_key is absent', () => {
    const item = new ResumeHistoryItem(makeEntity({ pdf_s3_key: null }));
    expect(item.canDownload).toBe(false);
  });

  it('sets nullable fields to null when absent on entity', () => {
    const item = new ResumeHistoryItem(
      makeEntity({
        optimization_confidence: null,
        keywords_added: null,
        sections_optimized: null,
        template_id: null,
      }),
    );
    expect(item.optimizationConfidence).toBeNull();
    expect(item.keywordsAdded).toBeNull();
    expect(item.sectionsOptimized).toBeNull();
    expect(item.templateId).toBeNull();
  });
});

describe('ResumeHistoryDetail', () => {
  it('includes all ResumeHistoryItem fields plus achievementsQuantified and changesDiff', () => {
    const detail = new ResumeHistoryDetail(makeEntity());
    expect(detail.id).toBe('gen-uuid');
    expect(detail.companyName).toBe('Acme Corp');
    expect(detail.achievementsQuantified).toBe(3);
    expect(detail.changesDiff).toEqual({ added: ['TypeScript'], removed: [] });
  });

  it('sets achievementsQuantified to null when absent', () => {
    const detail = new ResumeHistoryDetail(
      makeEntity({ achievements_quantified: null }),
    );
    expect(detail.achievementsQuantified).toBeNull();
  });

  it('sets changesDiff to null when absent', () => {
    const detail = new ResumeHistoryDetail(
      makeEntity({ changes_diff: null }),
    );
    expect(detail.changesDiff).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="resume-history.model.spec" --no-coverage
```

Expected: FAIL — module does not exist yet.

- [ ] **Step 3: Create `src/modules/resume-tailoring/models/resume-history.model.ts`**

```typescript
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';

/**
 * API-facing model for a single resume generation history entry.
 * Maps snake_case entity fields to camelCase and centralises
 * any presentation logic (e.g. canDownload derived from pdf_s3_key).
 */
export class ResumeHistoryItem {
  id: string;
  companyName: string;
  jobPosition: string;
  optimizationConfidence: number | null;
  keywordsAdded: number | null;
  sectionsOptimized: number | null;
  templateId: string | null;
  createdAt: Date;
  /** True when a PDF is stored in S3 and download-by-id will succeed. */
  canDownload: boolean;

  constructor(entity: ResumeGeneration) {
    this.id = entity.id;
    this.companyName = entity.company_name;
    this.jobPosition = entity.job_position;
    this.optimizationConfidence = entity.optimization_confidence ?? null;
    this.keywordsAdded = entity.keywords_added ?? null;
    this.sectionsOptimized = entity.sections_optimized ?? null;
    this.templateId = entity.template_id ?? null;
    this.createdAt = entity.created_at;
    this.canDownload = Boolean(entity.pdf_s3_key);
  }
}

/**
 * Extended model returned by the single-generation detail endpoint.
 * Includes the full AI diff and achievements count on top of the list fields.
 */
export class ResumeHistoryDetail extends ResumeHistoryItem {
  achievementsQuantified: number | null;
  changesDiff: any;

  constructor(entity: ResumeGeneration) {
    super(entity);
    this.achievementsQuantified = entity.achievements_quantified ?? null;
    this.changesDiff = entity.changes_diff ?? null;
  }
}

/**
 * Paginated wrapper returned by the paginated history endpoint.
 */
export interface PaginatedResumeHistory {
  items: ResumeHistoryItem[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="resume-history.model.spec" --no-coverage
```

Expected: all 8 tests PASS.

---

## Task 7: Enforce 30-day history lookback for FREEMIUM — use constant and model class

**Files:**
- Modify: `src/modules/resume-tailoring/services/resume.service.ts`
- Modify: `src/modules/resume-tailoring/resume-tailoring.controller.ts`

This task wires together Tasks 5 and 6. Both history methods use `FREEMIUM_HISTORY_LOOKBACK_DAYS` (not the literal `30`) and `new ResumeHistoryItem(r)` / `new ResumeHistoryDetail(record)` (not inline object spreads).

- [ ] **Step 1: Write failing tests**

Create `src/modules/resume-tailoring/services/resume.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ResumeService } from './resume.service';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { Resume } from '../../../database/entities/resume.entity';
import { User, UserPlan } from '../../../database/entities/user.entity';
import { ResumeTemplateService } from './resume-templates.service';
import { AIContentService } from '../../../shared/services/ai-content.service';
import { ConfigService } from '@nestjs/config';
import { S3Service } from '../../../shared/modules/external/services/s3.service';
import { TailoredResumePdfStorageService } from './tailored-resume-pdf-storage.service';
import { FREEMIUM_HISTORY_LOOKBACK_DAYS } from '../../../shared/constants/plan-limits.constants';

describe('ResumeService — history 30-day lookback', () => {
  let service: ResumeService;
  let findSpy: jest.Mock;
  let qbAndWhereSpy: jest.Mock;

  const mockRecord = {
    id: 'gen-1',
    company_name: 'Acme',
    job_position: 'Engineer',
    optimization_confidence: 90,
    keywords_added: 5,
    sections_optimized: 3,
    template_id: 'tpl-1',
    created_at: new Date(),
    pdf_s3_key: 'key',
  } as ResumeGeneration;

  beforeEach(async () => {
    findSpy = jest.fn().mockResolvedValue([mockRecord]);
    qbAndWhereSpy = jest.fn().mockReturnThis();

    const mockQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: qbAndWhereSpy,
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[mockRecord], 1]),
    };

    const mockResumeGenerationRepo = {
      find: findSpy,
      createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumeService,
        { provide: ResumeTemplateService, useValue: {} },
        { provide: AIContentService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: getRepositoryToken(ResumeGeneration),
          useValue: mockResumeGenerationRepo,
        },
        { provide: getRepositoryToken(Resume), useValue: {} },
        { provide: getRepositoryToken(User), useValue: {} },
        { provide: S3Service, useValue: {} },
        { provide: TailoredResumePdfStorageService, useValue: {} },
      ],
    }).compile();

    service = module.get<ResumeService>(ResumeService);
  });

  describe('getResumeGenerationHistory', () => {
    it('applies no date filter for PREMIUM users', async () => {
      await service.getResumeGenerationHistory('user-1', 10, UserPlan.PREMIUM);
      const callArg = findSpy.mock.calls[0][0];
      expect(callArg.where.created_at).toBeUndefined();
    });

    it('applies a date filter for FREEMIUM users', async () => {
      await service.getResumeGenerationHistory('user-1', 10, UserPlan.FREEMIUM);
      const callArg = findSpy.mock.calls[0][0];
      expect(callArg.where.created_at).toBeDefined();
    });

    it('cutoff is approximately FREEMIUM_HISTORY_LOOKBACK_DAYS days ago', async () => {
      await service.getResumeGenerationHistory('user-1', 10, UserPlan.FREEMIUM);
      const callArg = findSpy.mock.calls[0][0];
      const cutoff: Date = callArg.where.created_at.value;
      const expected = new Date();
      expected.setDate(expected.getDate() - FREEMIUM_HISTORY_LOOKBACK_DAYS);
      expect(cutoff.getTime()).toBeCloseTo(expected.getTime(), -3);
    });

    it('applies no date filter when plan is undefined', async () => {
      await service.getResumeGenerationHistory('user-1', 10);
      const callArg = findSpy.mock.calls[0][0];
      expect(callArg.where.created_at).toBeUndefined();
    });

    it('returns ResumeHistoryItem instances', async () => {
      const { ResumeHistoryItem } = await import('../models/resume-history.model');
      const result = await service.getResumeGenerationHistory('user-1', 10);
      expect(result[0]).toBeInstanceOf(ResumeHistoryItem);
    });
  });

  describe('getResumeGenerationHistoryPaginated', () => {
    it('does not add a date andWhere clause for PREMIUM users', async () => {
      await service.getResumeGenerationHistoryPaginated('user-1', {
        plan: UserPlan.PREMIUM,
      });
      const dateCalls = qbAndWhereSpy.mock.calls.filter((c) =>
        String(c[0]).includes('created_at'),
      );
      expect(dateCalls).toHaveLength(0);
    });

    it('adds a date andWhere clause for FREEMIUM users', async () => {
      await service.getResumeGenerationHistoryPaginated('user-1', {
        plan: UserPlan.FREEMIUM,
      });
      const dateCalls = qbAndWhereSpy.mock.calls.filter((c) =>
        String(c[0]).includes('created_at'),
      );
      expect(dateCalls).toHaveLength(1);
      expect(dateCalls[0][0]).toContain('rg.created_at >= :cutoff');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="resume.service.spec" --no-coverage
```

Expected: FAIL — current methods have no `plan` param, no date filter, and no model class usage.

- [ ] **Step 3: Update imports in `resume.service.ts`**

Change the existing `typeorm` import from:

```typescript
import { Repository } from 'typeorm';
```

to:

```typescript
import { Repository, MoreThanOrEqual, FindOptionsWhere } from 'typeorm';
```

Change the existing user entity import from:

```typescript
import { User } from '../../../database/entities/user.entity';
```

to:

```typescript
import { User, UserPlan } from '../../../database/entities/user.entity';
```

Add these two new imports after the existing entity imports:

```typescript
import {
  ResumeHistoryItem,
  ResumeHistoryDetail,
  PaginatedResumeHistory,
} from '../models/resume-history.model';
import { FREEMIUM_HISTORY_LOOKBACK_DAYS } from '../../../shared/constants/plan-limits.constants';
```

- [ ] **Step 4: Remove the old inline interfaces from `resume.service.ts`**

Delete these three exported interfaces that are now replaced by the model file (currently lines 18–41):

```typescript
export interface ResumeHistoryItem { ... }   // DELETE
export interface ResumeHistoryDetail extends ResumeHistoryItem { ... }  // DELETE
export interface PaginatedResumeHistory { ... }  // DELETE
```

- [ ] **Step 5: Replace `getResumeGenerationHistory()` in `resume.service.ts`**

Replace the existing method (lines ~228–260):

```typescript
  async getResumeGenerationHistory(
    userId: string,
    limit = 10,
    plan?: string,
  ): Promise<ResumeHistoryItem[]> {
    const where: FindOptionsWhere<ResumeGeneration> = { user_id: userId };

    if (plan === UserPlan.FREEMIUM) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - FREEMIUM_HISTORY_LOOKBACK_DAYS);
      where.created_at = MoreThanOrEqual(cutoff);
    }

    const records = await this.resumeGenerationRepository.find({
      where,
      order: { created_at: 'DESC' },
      take: limit,
      select: [
        'id',
        'company_name',
        'job_position',
        'optimization_confidence',
        'keywords_added',
        'sections_optimized',
        'template_id',
        'created_at',
        'pdf_s3_key',
      ],
    });

    return records.map((r) => new ResumeHistoryItem(r));
  }
```

- [ ] **Step 6: Replace `getResumeGenerationHistoryPaginated()` in `resume.service.ts`**

Replace the existing method (lines ~262–318):

```typescript
  async getResumeGenerationHistoryPaginated(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      search?: string;
      sortOrder?: 'ASC' | 'DESC';
      plan?: string;
    } = {},
  ): Promise<PaginatedResumeHistory> {
    const { page = 1, limit = 10, search, sortOrder = 'DESC', plan } = options;
    const skip = (page - 1) * limit;

    const qb = this.resumeGenerationRepository
      .createQueryBuilder('rg')
      .where('rg.user_id = :userId', { userId });

    if (plan === UserPlan.FREEMIUM) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - FREEMIUM_HISTORY_LOOKBACK_DAYS);
      qb.andWhere('rg.created_at >= :cutoff', { cutoff });
    }

    if (search) {
      qb.andWhere(
        '(LOWER(rg.company_name) LIKE :search OR LOWER(rg.job_position) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    qb.select([
      'rg.id',
      'rg.company_name',
      'rg.job_position',
      'rg.optimization_confidence',
      'rg.keywords_added',
      'rg.sections_optimized',
      'rg.template_id',
      'rg.created_at',
      'rg.pdf_s3_key',
    ])
      .orderBy('rg.created_at', sortOrder)
      .skip(skip)
      .take(limit);

    const [records, total] = await qb.getManyAndCount();

    return {
      items: records.map((r) => new ResumeHistoryItem(r)),
      total,
      page,
      limit,
    };
  }
```

- [ ] **Step 7: Replace `getResumeGenerationDetail()` in `resume.service.ts` to use `ResumeHistoryDetail`**

Replace the existing method (lines ~320–361):

```typescript
  async getResumeGenerationDetail(
    generationId: string,
    userId: string,
  ): Promise<ResumeHistoryDetail> {
    const record = await this.resumeGenerationRepository.findOne({
      where: { id: generationId, user_id: userId },
      select: [
        'id',
        'company_name',
        'job_position',
        'optimization_confidence',
        'keywords_added',
        'sections_optimized',
        'achievements_quantified',
        'changes_diff',
        'template_id',
        'created_at',
        'pdf_s3_key',
      ],
    });

    if (!record) {
      throw new NotFoundException(
        'Resume generation not found',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    return new ResumeHistoryDetail(record);
  }
```

- [ ] **Step 8: Update `getResumeHistory` handler in `resume-tailoring.controller.ts`**

Replace the existing `getResumeHistory` handler (lines 69–99):

```typescript
  @Get('history')
  @TransformUserContext()
  async getResumeHistory(
    @Req() req: RequestWithUserContext,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    const userId = req.userContext?.userId;
    const plan = req.userContext?.plan;

    if (!userId) {
      throw new BadRequestException(
        'Authentication required',
        ERROR_CODES.AUTH_REQUIRED,
      );
    }

    if (page !== undefined) {
      return this.resumeService.getResumeGenerationHistoryPaginated(userId, {
        page: parseInt(page, 10) || 1,
        limit: parseInt(limit ?? '10', 10) || 10,
        search,
        sortOrder: sortOrder ?? 'DESC',
        plan,
      });
    }

    return this.resumeService.getResumeGenerationHistory(
      userId,
      parseInt(limit ?? '10', 10) || 10,
      plan,
    );
  }
```

- [ ] **Step 9: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="resume.service.spec" --no-coverage
```

Expected: all tests PASS.

---

## Task 8: Gate batch generation behind `PremiumUserGuard` and re-enable rate limiting

**Files:**
- Modify: `src/modules/resume-tailoring/resume-tailoring.controller.ts`
- Modify: `src/modules/resume-tailoring/resume-tailoring.controller.spec.ts`

- [ ] **Step 1: Write failing tests — append to `resume-tailoring.controller.spec.ts`**

Add this `describe` block at the bottom of the existing spec file:

```typescript
import { PremiumUserGuard } from '../auth/guards/premium-user.guard';

describe('PremiumUserGuard — unit behaviour used on batch route', () => {
  const guard = new PremiumUserGuard();

  const makeContext = (isPremium: boolean) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        userContext: {
          userId: 'user-1',
          userType: 'registered',
          plan: isPremium ? 'premium' : 'freemium',
          isPremium,
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        },
      }),
    }),
  });

  it('throws ForbiddenException for FREEMIUM users', () => {
    expect(() => guard.canActivate(makeContext(false) as any)).toThrow();
  });

  it('returns true for PREMIUM users', () => {
    expect(guard.canActivate(makeContext(true) as any)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass as written**

```bash
npm test -- --testPathPattern="resume-tailoring.controller.spec" --no-coverage
```

Expected: the two new guard unit tests PASS (guard logic already exists — this confirms the behaviour before wiring it to the route).

- [ ] **Step 3: Add `PremiumUserGuard` import to `resume-tailoring.controller.ts`**

Add alongside the existing guard imports:

```typescript
import { PremiumUserGuard } from '../auth/guards/premium-user.guard';
```

- [ ] **Step 4: Update the batch route decorator stack in `resume-tailoring.controller.ts`**

Replace the existing decorators above `async batchGenerateTailoredResumes` (the three lines starting at `@Post('batch-generate')`):

```typescript
  @Post('batch-generate')
  @HttpCode(HttpStatus.OK)
  @TransformUserContext()
  @UseGuards(PremiumUserGuard)
  @RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)
  async batchGenerateTailoredResumes(
```

The commented-out `// @RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)` line is removed and the active decorator is in its place.

- [ ] **Step 5: Run the full test suite**

```bash
npm test -- --no-coverage
```

Expected: all tests PASS — no regressions.

- [ ] **Step 6: Build to confirm no type errors**

```bash
npm run build
```

Expected: build succeeds with no errors.

---

## Final verification before handing back for review

- [ ] **Run full test suite**

```bash
npm test -- --no-coverage
```

Expected: all tests PASS.

- [ ] **Run linter**

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Verify no hardcoded magic number `30` in history logic**

```bash
grep -n "setDate.*30\|lookback.*30\|days.*30" src/modules/resume-tailoring/services/resume.service.ts
```

Expected: no output — only `FREEMIUM_HISTORY_LOOKBACK_DAYS` is referenced.

- [ ] **Verify no bare feature strings in rate limit service**

```bash
grep -n "'resume_generation'\|'cover_letter'\|'resume_batch_generation'" src/modules/rate-limit/rate-limit.service.ts
```

Expected: no output — only `FeatureType.*` enum references.

- [ ] **Verify batch route has both decorators active (no comment prefix)**

```bash
grep -A 6 "batch-generate" src/modules/resume-tailoring/resume-tailoring.controller.ts | head -8
```

Expected: output includes `PremiumUserGuard` and `@RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)` with no `//` prefix.

- [ ] **Verify `WEEKLY` is gone from the codebase**

```bash
grep -r "WEEKLY" src/ --include="*.ts"
```

Expected: no output.
