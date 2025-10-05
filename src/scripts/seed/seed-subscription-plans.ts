import { DataSource } from 'typeorm';
import { SubscriptionPlan } from '../../modules/subscription/entities/subscription-plan.entity';

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
      planName: 'Weekly',
      description: 'Perfect for short-term projects and quick resume optimization. Get access to all premium features for one week, including unlimited ATS score checks, resume generation, and job application tracking.',
      price: 9.99,
      currency: 'USD',
      lemonSqueezyVariantId: '1012063',
      billingCycle: 'weekly',
      isActive: true,
      features: [
        'Unlimited ATS score checks',
        'Resume generation with all templates',
        'Job application tracking',
        'Priority customer support',
        '7-day access'
      ]
    },
    {
      planName: 'Monthly',
      description: 'Our most popular plan for job seekers who want comprehensive resume optimization and job search tools. Best value for active job hunting with full feature access for 30 days.',
      price: 34.99,
      currency: 'USD',
      lemonSqueezyVariantId: '1012070',
      billingCycle: 'monthly',
      isActive: true,
      features: [
        'Unlimited ATS score checks',
        'All premium resume templates',
        'Advanced job application tracking',
        'Resume optimization suggestions',
        'Interview preparation tools',
        'Priority customer support',
        '30-day access'
      ]
    },
    {
      planName: 'Premium Monthly',
      description: 'Enterprise-grade solution for professionals and career coaches. Includes advanced analytics, bulk resume processing, and premium support for serious job seekers and career professionals.',
      price: 100.00,
      currency: 'USD',
      lemonSqueezyVariantId: '1012071',
      billingCycle: 'monthly',
      isActive: true,
      features: [
        'Unlimited everything',
        'Advanced analytics and reporting',
        'Bulk resume processing',
        'Custom resume templates',
        'White-label solutions',
        'Dedicated account manager',
        'API access',
        '24/7 premium support',
        'Custom integrations'
      ]
    }
  ];

  for (const planData of subscriptionPlans) {
    const plan = repo.create(planData);
    await repo.save(plan);
    console.log(`Seeded subscription plan: ${planData.planName} - $${planData.price}`);
  }

  console.log('All subscription plans seeded successfully.');
}