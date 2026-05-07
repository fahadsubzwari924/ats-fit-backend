/**
 * Standalone seed runner — no NestFactory, no Redis dependency.
 *
 * Initializes AppDataSource directly so only a Postgres connection is needed.
 * Pass DATABASE_URL in the environment to target any Postgres instance
 * (e.g., Railway's public URL) without touching .env.prod.
 *
 * Usage:
 *   DATABASE_URL="<url>" NODE_ENV=production \
 *     npx ts-node -r tsconfig-paths/register src/scripts/seed/run-all-seeds-standalone.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.prod for AWS credentials and other non-DB vars.
// dotenv does NOT override vars already set in the environment,
// so a DATABASE_URL passed externally takes precedence automatically.
const envFile =
  process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
const envPath = path.resolve(__dirname, '../../../config', envFile);
dotenv.config({ path: envPath });

import { AppDataSource } from '../../database/data-source';
import { seedSubscriptionPlans } from './seed-subscription-plans';
import { seedResumeTemplates } from './seed-resume-templates';
import { RateLimitConfig } from '../../database/entities/rate-limit-config.entity';
import { UserPlan, UserType } from '../../database/entities/user.entity';
import { FeatureType } from '../../database/entities/usage-tracking.entity';

async function seedRateLimitConfigs() {
  const repo = AppDataSource.getRepository(RateLimitConfig);

  const configs = [
    {
      plan: UserPlan.FREEMIUM,
      user_type: UserType.REGISTERED,
      feature_type: FeatureType.RESUME_GENERATION,
      monthly_limit: 3,
      description: 'Free plan: 3 tailored resumes per month',
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
      description:
        'Pro plan: 30 tailored resumes per month — single + batch share this pool',
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
      description:
        'Pro plan: 10 batch jobs per month (structural cap; each resume in a batch also counts toward the 30/mo tailored-resume pool)',
    },
  ];

  for (const cfg of configs) {
    const existing = await repo.findOne({
      where: {
        plan: cfg.plan,
        user_type: cfg.user_type,
        feature_type: cfg.feature_type,
      },
    });
    if (!existing) {
      await repo.save(repo.create(cfg));
      console.log(`  ✓ Created rate limit config: ${cfg.description}`);
    } else {
      console.log(`  — Skipped (already exists): ${cfg.description}`);
    }
  }
}

async function main() {
  console.log('\n========================================');
  console.log('  ATS Fit — Production Seed Runner');
  console.log('========================================\n');

  console.log('Connecting to database...');
  await AppDataSource.initialize();
  console.log('✓ Database connected\n');

  console.log('── Step 1/3: Subscription Plans ────────');
  await seedSubscriptionPlans(AppDataSource);
  console.log();

  console.log('── Step 2/3: Resume Templates ──────────');
  await seedResumeTemplates(AppDataSource);
  console.log();

  console.log('── Step 3/3: Rate Limit Configs ────────');
  await seedRateLimitConfigs();
  console.log();

  await AppDataSource.destroy();

  console.log('========================================');
  console.log('  All seeds completed successfully ✓');
  console.log('========================================\n');
}

main().catch((err) => {
  console.error('\n✗ Seed failed:', err);
  process.exit(1);
});
