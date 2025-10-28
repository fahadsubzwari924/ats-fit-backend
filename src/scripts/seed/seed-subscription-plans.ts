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
      plan_name: 'Weekly',
      description:
        'Perfect for short-term projects and quick resume optimization. Get access to all premium features for one week, including unlimited ATS score checks, resume generation, and job application tracking.',
      price: 9.99,
      currency: Currency.USD,
      payment_gateway_variant_id: '1012063',
      billing_cycle: BillingCycle.WEEKLY,
      is_active: true,
      features: [
        'Unlimited ATS score checks',
        'Resume generation with all templates',
        'Job application tracking',
        'Priority customer support',
        '7-day access',
      ],
    },
    {
      plan_name: 'Monthly',
      description:
        'Our most popular plan for job seekers who want comprehensive resume optimization and job search tools. Best value for active job hunting with full feature access for 30 days.',
      price: 34.99,
      currency: Currency.USD,
      payment_gateway_variant_id: '1012070',
      billing_cycle: BillingCycle.MONTHLY,
      is_active: true,
      features: [
        'Unlimited ATS score checks',
        'All premium resume templates',
        'Advanced job application tracking',
        'Resume optimization suggestions',
        'Interview preparation tools',
        'Priority customer support',
        '30-day access',
      ],
    },
    {
      plan_name: 'Premium Monthly',
      description:
        'Enterprise-grade solution for professionals and career coaches. Includes advanced analytics, bulk resume processing, and premium support for serious job seekers and career professionals.',
      price: 100.0,
      currency: Currency.USD,
      payment_gateway_variant_id: '1012071',
      billing_cycle: BillingCycle.MONTHLY,
      is_active: true,
      features: [
        'Unlimited everything',
        'Advanced analytics and reporting',
        'Bulk resume processing',
        'Custom resume templates',
        'White-label solutions',
        'Dedicated account manager',
        'API access',
        '24/7 premium support',
        'Custom integrations',
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
