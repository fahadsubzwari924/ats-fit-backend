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
      payment_gateway_variant_id: '1012070',
      is_active: true,
      features: [
        '30 tailored resumes per month — single or batch',
        '15 cover letters per month',
        '100 job-fit checks per month',
        {
          title: 'Batch tailoring',
          subitems: [
            'Up to 10 batch jobs per month',
            'Up to 3 resumes per batch',
            'Each resume counts toward your monthly 30',
          ],
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
      payment_gateway_variant_id: '1012071',
      is_active: true,
      features: [
        '30 tailored resumes per month — single or batch',
        '15 cover letters per month',
        '100 job-fit checks per month',
        {
          title: 'Batch tailoring',
          subitems: [
            'Up to 10 batch jobs per month',
            'Up to 3 resumes per batch',
            'Each resume counts toward your monthly 30',
          ],
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
