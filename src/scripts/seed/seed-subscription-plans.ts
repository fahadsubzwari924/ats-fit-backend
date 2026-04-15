import { DataSource } from 'typeorm';
import { BillingCycle } from '../../modules/subscription/enums';
import { Currency } from '../../modules/subscription/enums/payment.enum';
import { SubscriptionPlan } from '../../database/entities';

export async function seedSubscriptionPlans(dataSource: DataSource) {
  const repo = dataSource.getRepository(SubscriptionPlan);

  // Check if subscription plans already exist
  const existingPlansCount = await repo.count();
  if (existingPlansCount > 0) {
    console.log('Subscription plans already exist. Skipping seeding.');
    return;
  }

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

  for (const planData of subscriptionPlans) {
    const plan = repo.create(planData);
    await repo.save(plan);
    console.log(
      `Seeded subscription plan: ${planData.plan_name} - $${planData.price}`,
    );
  }

  console.log('All subscription plans seeded successfully.');
}
