import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment configuration - use the same pattern as other seed files
const envFile = process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev';
const envPath = path.resolve(__dirname, '../../../config', envFile);
dotenv.config({ path: envPath });

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { seedSubscriptionPlans } from './seed-subscription-plans';
import { AppModule } from '../../app.module';

async function runSubscriptionPlansSeed() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const dataSource = app.get(DataSource);
  await seedSubscriptionPlans(dataSource);

  await app.close();
  console.log('Subscription plans seeding completed.');
}

runSubscriptionPlansSeed().catch((err) => {
  console.error('Error during subscription plans seeding:', err);
  process.exit(1);
});