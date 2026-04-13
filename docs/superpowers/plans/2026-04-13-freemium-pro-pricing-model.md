# Freemium + Pro Pricing Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old three-plan seed data and misaligned rate limit configs with a clean Freemium + Pro two-tier pricing model, enforcing all per-plan limits in the backend.

**Architecture:** All changes are confined to six existing files — no new files, no migrations. The `BillingCycle` enum loses `WEEKLY`, seed data is rewritten with two Pro plans, the rate limit service gains full coverage for all gated features, the history service enforces a 30-day lookback for FREEMIUM users, and the batch route is gated behind `PremiumUserGuard`.

**Tech Stack:** NestJS, TypeORM, Jest, TypeScript

**Design spec:** `docs/superpowers/specs/2026-04-13-freemium-pro-pricing-model-design.md`

---

## File Map

| File | Change |
|------|--------|
| `src/modules/subscription/enums/billing-cycle.enum.ts` | Remove `WEEKLY` |
| `src/scripts/seed/seed-subscription-plans.ts` | Replace 3 old plans with Pro Monthly + Pro Annual |
| `src/scripts/seed/seed-subscription-plans-service.ts` | Same replacement |
| `src/modules/rate-limit/rate-limit.service.ts` | Rewrite `initializeRateLimitConfigs()`; expand `getUserUsageStats()` and `getFormattedFeatureUsage()` |
| `src/modules/resume-tailoring/services/resume.service.ts` | Add `plan` param + 30-day filter to both history methods |
| `src/modules/resume-tailoring/resume-tailoring.controller.ts` | Pass `plan` to history calls; add `PremiumUserGuard` + uncomment `@RateLimitFeature` on batch route |

---

## Task 1: Remove `WEEKLY` from BillingCycle enum

**Files:**
- Modify: `src/modules/subscription/enums/billing-cycle.enum.ts`

No test needed — TypeScript compilation validates that no code references the removed value. Run the build after this step to catch any lingering references.

- [ ] **Step 1: Remove `WEEKLY` from the enum**

Replace the entire file content:

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
grep -r "BillingCycle.WEEKLY\|billing_cycle.*weekly\|WEEKLY" src/ --include="*.ts"
```

Expected: no output (zero matches).

- [ ] **Step 3: Build to confirm no type errors**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/subscription/enums/billing-cycle.enum.ts
git commit -m "chore: remove WEEKLY billing cycle — no plan uses it"
```

---

## Task 2: Replace subscription plan seed data

**Files:**
- Modify: `src/scripts/seed/seed-subscription-plans.ts`
- Modify: `src/scripts/seed/seed-subscription-plans-service.ts`

Both files define the same plan array. Update both to the two Pro plans. Placeholder Lemon Squeezy variant IDs will be swapped before launch.

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

    const existingPlans = await subscriptionPlanService.findAll();
    if (existingPlans.length > 0) {
      logger.log('Subscription plans already exist. Skipping seeding.');
      await app.close();
      return;
    }

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

- [ ] **Step 3: Commit**

```bash
git add src/scripts/seed/seed-subscription-plans.ts src/scripts/seed/seed-subscription-plans-service.ts
git commit -m "feat: replace old plan seeds with Pro Monthly and Pro Annual"
```

---

## Task 3: Rewrite `initializeRateLimitConfigs()` with complete new config set

**Files:**
- Modify: `src/modules/rate-limit/rate-limit.service.ts` (only `initializeRateLimitConfigs` method, lines 289–329)

- [ ] **Step 1: Write a failing test**

Create `src/modules/rate-limit/rate-limit.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RateLimitService } from './rate-limit.service';
import { UsageTracking } from '../../database/entities/usage-tracking.entity';
import { RateLimitConfig } from '../../database/entities/rate-limit-config.entity';
import { UserPlan, UserType } from '../../database/entities/user.entity';
import { FeatureType } from '../../database/entities/usage-tracking.entity';

describe('RateLimitService.initializeRateLimitConfigs', () => {
  let service: RateLimitService;
  let savedConfigs: any[];

  const mockRateLimitConfigRepo = {
    findOne: jest.fn().mockResolvedValue(null), // nothing exists yet
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
    // Only 4 saved (first one skipped)
    expect(savedConfigs).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --testPathPattern="rate-limit.service.spec" --no-coverage
```

Expected: FAIL — tests fail because the current method has wrong limits (5, 50, 25) and is missing COVER_LETTER configs.

- [ ] **Step 3: Rewrite `initializeRateLimitConfigs()` in `rate-limit.service.ts`**

Replace lines 288–329 (the entire method):

```typescript
  /**
   * Initialize rate limit configurations if they don't exist.
   * Freemium + Pro two-tier model:
   *   Free:  3 resume generations, 1 cover letter per month
   *   Pro:  30 resume generations, 15 cover letters, 10 batch generations per month
   * Batch generation has no FREEMIUM config row — it is blocked at the route level
   * by PremiumUserGuard before the rate limit guard ever runs.
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

- [ ] **Step 5: Commit**

```bash
git add src/modules/rate-limit/rate-limit.service.ts src/modules/rate-limit/rate-limit.service.spec.ts
git commit -m "feat: rewrite rate limit configs for Freemium + Pro model"
```

---

## Task 4: Expand `getUserUsageStats()` and `getFormattedFeatureUsage()` to cover all features

**Files:**
- Modify: `src/modules/rate-limit/rate-limit.service.ts`

Currently both methods only surface `resume_generation`. They need to include `cover_letter` for all users and `resume_batch_generation` for PREMIUM users only.

- [ ] **Step 1: Write failing tests — add to `rate-limit.service.spec.ts`**

Append this new `describe` block to the existing spec file:

```typescript
describe('RateLimitService.getUserUsageStats', () => {
  let service: RateLimitService;

  const makeRateLimitResult = (limit: number) => ({
    allowed: true,
    currentUsage: 1,
    limit,
    remaining: limit - 1,
    resetDate: new Date(),
    usagePercentage: Math.round((1 / limit) * 100),
  });

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
      return Promise.resolve(limit ? { monthly_limit: limit, is_active: true } : null);
    }),
    save: jest.fn(),
  };

  const mockUsageTrackingRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(),
    create: jest.fn().mockImplementation((v) => v),
  };

  beforeEach(async () => {
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
    userId: 'user-1',
    userType: 'registered',
    plan: UserPlan.FREEMIUM,
    isPremium: false,
    ipAddress: '127.0.0.1',
    userAgent: 'test',
  };

  const premiumContext = {
    ...freemiumContext,
    plan: UserPlan.PREMIUM,
    isPremium: true,
  };

  describe('getUserUsageStats', () => {
    it('returns resume_generation and cover_letter for FREEMIUM user', async () => {
      const stats = await service.getUserUsageStats(freemiumContext);
      expect(stats.resume_generation).toBeDefined();
      expect(stats.cover_letter).toBeDefined();
      expect(stats.resume_batch_generation).toBeUndefined();
    });

    it('returns resume_generation, cover_letter and resume_batch_generation for PREMIUM user', async () => {
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
    it('returns 2 entries for FREEMIUM user', async () => {
      const result = await service.getFormattedFeatureUsage(freemiumContext);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.feature)).toEqual([
        'resume_generation',
        'cover_letter',
      ]);
    });

    it('returns 3 entries for PREMIUM user', async () => {
      const result = await service.getFormattedFeatureUsage(premiumContext);
      expect(result).toHaveLength(3);
      expect(result.map((r) => r.feature)).toEqual([
        'resume_generation',
        'cover_letter',
        'resume_batch_generation',
      ]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --testPathPattern="rate-limit.service.spec" --no-coverage
```

Expected: FAIL — `getUserUsageStats` currently returns only `resume_generation`, and `getFormattedFeatureUsage` only has 1 entry.

- [ ] **Step 3: Update `getUserUsageStats()` in `rate-limit.service.ts`**

Replace the existing `getUserUsageStats` method (lines ~252–264):

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

- [ ] **Step 4: Update `getFormattedFeatureUsage()` in `rate-limit.service.ts`**

Replace the existing `getFormattedFeatureUsage` method (lines ~266–284):

```typescript
  /**
   * Get formatted feature usage for API responses.
   * Returns 2 entries for FREEMIUM, 3 for PREMIUM.
   */
  async getFormattedFeatureUsage(
    userContext: UserContext,
  ): Promise<FormattedFeatureUsage[]> {
    const stats = await this.getUserUsageStats(userContext);

    const result: FormattedFeatureUsage[] = [
      {
        feature: 'resume_generation',
        allowed: stats.resume_generation.limit,
        remaining: stats.resume_generation.remaining,
        used: stats.resume_generation.currentUsage,
        usagePercentage: `${stats.resume_generation.usagePercentage}%`,
        resetDate: stats.resume_generation.resetDate,
      },
      {
        feature: 'cover_letter',
        allowed: stats.cover_letter.limit,
        remaining: stats.cover_letter.remaining,
        used: stats.cover_letter.currentUsage,
        usagePercentage: `${stats.cover_letter.usagePercentage}%`,
        resetDate: stats.cover_letter.resetDate,
      },
    ];

    if (stats.resume_batch_generation) {
      result.push({
        feature: 'resume_batch_generation',
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

- [ ] **Step 6: Commit**

```bash
git add src/modules/rate-limit/rate-limit.service.ts src/modules/rate-limit/rate-limit.service.spec.ts
git commit -m "feat: expand usage stats and dashboard to cover all plan features"
```

---

## Task 5: Enforce 30-day history lookback for FREEMIUM users

**Files:**
- Modify: `src/modules/resume-tailoring/services/resume.service.ts`
- Modify: `src/modules/resume-tailoring/resume-tailoring.controller.ts`

The two history methods (`getResumeGenerationHistory` and `getResumeGenerationHistoryPaginated`) receive a new optional `plan` argument. When `plan === UserPlan.FREEMIUM`, a 30-day date filter is applied to the query. PREMIUM users get no filter — full history.

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
  };

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
        { provide: getRepositoryToken(ResumeGeneration), useValue: mockResumeGenerationRepo },
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
      const call = findSpy.mock.calls[0][0];
      expect(call.where.created_at).toBeUndefined();
    });

    it('applies 30-day date filter for FREEMIUM users', async () => {
      await service.getResumeGenerationHistory('user-1', 10, UserPlan.FREEMIUM);
      const call = findSpy.mock.calls[0][0];
      expect(call.where.created_at).toBeDefined();
      // cutoff should be approximately 30 days ago
      const cutoff: Date = call.where.created_at.value;
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      expect(cutoff.getTime()).toBeCloseTo(thirtyDaysAgo.getTime(), -3);
    });

    it('applies no date filter when plan is undefined (default)', async () => {
      await service.getResumeGenerationHistory('user-1', 10);
      const call = findSpy.mock.calls[0][0];
      expect(call.where.created_at).toBeUndefined();
    });
  });

  describe('getResumeGenerationHistoryPaginated', () => {
    it('does not call andWhere for date for PREMIUM users', async () => {
      await service.getResumeGenerationHistoryPaginated('user-1', {
        plan: UserPlan.PREMIUM,
      });
      const dateCalls = qbAndWhereSpy.mock.calls.filter((c) =>
        String(c[0]).includes('created_at'),
      );
      expect(dateCalls).toHaveLength(0);
    });

    it('calls andWhere with created_at filter for FREEMIUM users', async () => {
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

Expected: FAIL — current methods don't accept a `plan` argument and don't apply a date filter.

- [ ] **Step 3: Update imports in `resume.service.ts`**

Change the existing TypeORM import at the top of the file from:

```typescript
import { Repository } from 'typeorm';
```

to:

```typescript
import { Repository, MoreThanOrEqual, FindOptionsWhere } from 'typeorm';
```

Also update the user entity import from:

```typescript
import { User } from '../../../database/entities/user.entity';
```

to:

```typescript
import { User, UserPlan } from '../../../database/entities/user.entity';
```

- [ ] **Step 4: Update `getResumeGenerationHistory()` in `resume.service.ts`**

Replace the existing method (lines 228–260):

```typescript
  async getResumeGenerationHistory(
    userId: string,
    limit = 10,
    plan?: string,
  ): Promise<ResumeHistoryItem[]> {
    const where: FindOptionsWhere<ResumeGeneration> = { user_id: userId };

    if (plan === UserPlan.FREEMIUM) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
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

    return records.map((r) => ({
      id: r.id,
      companyName: r.company_name,
      jobPosition: r.job_position,
      optimizationConfidence: r.optimization_confidence,
      keywordsAdded: r.keywords_added,
      sectionsOptimized: r.sections_optimized,
      templateId: r.template_id,
      createdAt: r.created_at,
      canDownload: Boolean(r.pdf_s3_key),
    }));
  }
```

- [ ] **Step 5: Update `getResumeGenerationHistoryPaginated()` in `resume.service.ts`**

Replace the existing method (lines 262–318):

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
      cutoff.setDate(cutoff.getDate() - 30);
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
      items: records.map((r) => ({
        id: r.id,
        companyName: r.company_name,
        jobPosition: r.job_position,
        optimizationConfidence: r.optimization_confidence,
        keywordsAdded: r.keywords_added,
        sectionsOptimized: r.sections_optimized,
        templateId: r.template_id,
        createdAt: r.created_at,
        canDownload: Boolean(r.pdf_s3_key),
      })),
      total,
      page,
      limit,
    };
  }
```

- [ ] **Step 6: Update the `getResumeHistory` handler in `resume-tailoring.controller.ts`**

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

- [ ] **Step 7: Run tests to verify they pass**

```bash
npm test -- --testPathPattern="resume.service.spec" --no-coverage
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/resume-tailoring/services/resume.service.ts \
        src/modules/resume-tailoring/services/resume.service.spec.ts \
        src/modules/resume-tailoring/resume-tailoring.controller.ts
git commit -m "feat: enforce 30-day history lookback for Free plan users"
```

---

## Task 6: Gate batch generation behind `PremiumUserGuard` and re-enable rate limiting

**Files:**
- Modify: `src/modules/resume-tailoring/resume-tailoring.controller.ts`

Two changes to the `POST /resume-tailoring/batch-generate` route:
1. Add `@UseGuards(PremiumUserGuard)` — FREEMIUM users get `403` with `PREMIUM_REQUIRED` before touching the handler
2. Uncomment `@RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)` — Pro users are capped at 10 batches/month

- [ ] **Step 1: Write a failing test**

Add a new `describe` block to `src/modules/resume-tailoring/resume-tailoring.controller.spec.ts`:

```typescript
import { PremiumUserGuard } from '../auth/guards/premium-user.guard';
import { Reflector } from '@nestjs/core';

describe('ResumeTailoringController — batch route Premium gate', () => {
  it('PremiumUserGuard blocks FREEMIUM users with PREMIUM_REQUIRED', () => {
    const guard = new PremiumUserGuard();

    const freemiumContext = {
      userId: 'user-1',
      userType: 'registered',
      plan: 'freemium',
      isPremium: false,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    };

    const mockRequest = { userContext: freemiumContext };
    const mockContext = {
      switchToHttp: () => ({ getRequest: () => mockRequest }),
    } as any;

    expect(() => guard.canActivate(mockContext)).toThrow();
  });

  it('PremiumUserGuard allows PREMIUM users through', () => {
    const guard = new PremiumUserGuard();

    const premiumContext = {
      userId: 'user-1',
      userType: 'registered',
      plan: 'premium',
      isPremium: true,
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    };

    const mockRequest = { userContext: premiumContext };
    const mockContext = {
      switchToHttp: () => ({ getRequest: () => mockRequest }),
    } as any;

    expect(guard.canActivate(mockContext)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes as written**

```bash
npm test -- --testPathPattern="resume-tailoring.controller.spec" --no-coverage
```

Expected: the two new guard tests PASS (the guard logic already exists — this test confirms the behaviour is correct before wiring it to the route).

- [ ] **Step 3: Add `PremiumUserGuard` import to `resume-tailoring.controller.ts`**

Add this import alongside the existing guard imports at the top of the file:

```typescript
import { PremiumUserGuard } from '../auth/guards/premium-user.guard';
```

- [ ] **Step 4: Update the batch route decorators in `resume-tailoring.controller.ts`**

Replace the three decorator lines above `async batchGenerateTailoredResumes` (currently lines ~308–311):

```typescript
  @Post('batch-generate')
  @HttpCode(HttpStatus.OK)
  @TransformUserContext()
  @UseGuards(PremiumUserGuard)
  @RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)
  async batchGenerateTailoredResumes(
```

The `// @RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)` comment is removed and the decorator is now active.

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

- [ ] **Step 7: Commit**

```bash
git add src/modules/resume-tailoring/resume-tailoring.controller.ts \
        src/modules/resume-tailoring/resume-tailoring.controller.spec.ts
git commit -m "feat: gate batch generation behind PremiumUserGuard and re-enable rate limiting"
```

---

## Final verification

- [ ] **Run full test suite one last time**

```bash
npm test -- --no-coverage
```

Expected: all tests PASS.

- [ ] **Run linter**

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Verify BillingCycle.WEEKLY is gone**

```bash
grep -r "WEEKLY" src/ --include="*.ts"
```

Expected: no output.

- [ ] **Verify batch route has both decorators active**

```bash
grep -A 6 "batch-generate" src/modules/resume-tailoring/resume-tailoring.controller.ts | head -10
```

Expected output contains both `PremiumUserGuard` and `RateLimitFeature(FeatureType.RESUME_BATCH_GENERATION)` with no comment prefix.
