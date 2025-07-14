import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module';
import { RateLimitService } from '../../modules/rate-limit/rate-limit.service';
import { Logger } from '@nestjs/common';

async function seedRateLimits() {
  const logger = new Logger('SeedRateLimits');

  try {
    logger.log('Starting rate limit configuration seeding...');

    const app = await NestFactory.createApplicationContext(AppModule);
    const rateLimitService = app.get(RateLimitService);

    await rateLimitService.initializeRateLimitConfigs();

    logger.log('Rate limit configurations seeded successfully!');

    await app.close();
  } catch (error) {
    logger.error('Error seeding rate limit configurations:', error);
    process.exit(1);
  }
}

seedRateLimits();
