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
        description: '',
        price: 12.0,
        currency: Currency.USD,
        billing_cycle: BillingCycle.MONTHLY,
        payment_gateway_variant_id: 'PLACEHOLDER_MONTHLY_VARIANT_ID',
        is_active: true,
        features: [
          '30 tailored resumes per month',
          '15 cover letters per month',
          {
            title: 'Batch generation',
            subitems: ['Up to 3 jobs/batch', '10 batches/month'],
          },
          'All resume templates',
          'Unlimited job application tracking',
          'Full generation history',
          'Priority support',
        ],
      },
      {
        plan_name: 'Pro Annual',
        description: '',
        price: 89.0,
        currency: Currency.USD,
        billing_cycle: BillingCycle.YEARLY,
        payment_gateway_variant_id: 'PLACEHOLDER_ANNUAL_VARIANT_ID',
        is_active: true,
        features: [
          '30 tailored resumes per month',
          '15 cover letters per month',
          {
            title: 'Batch generation',
            subitems: ['Up to 3 jobs/batch', '10 batches/month'],
          },
          'All resume templates',
          'Unlimited job application tracking',
          'Full generation history',
          'Priority support',
          'Best value — save 38%',
        ],
      },
    ];

    // Check if subscription plans already exist
    const existingPlans = await subscriptionPlanService.findAll();
    if (existingPlans.length > 0) {
      logger.log('Subscription plans already exist. Skipping seeding.');
      return;
    }

    // Create subscription plans
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
