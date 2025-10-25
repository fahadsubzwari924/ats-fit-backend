/**
 * Example usage of the enhanced findAll method with dynamic query options
 * This file demonstrates the various ways to use the new dynamic query functionality
 */

import { BillingCycle } from '../enums';
import { SubscriptionPlanService } from '../services/subscription-plan.service';
import { ISubscriptionPlanQueryOptions } from '../interfaces/query.interface';

export class SubscriptionPlanQueryExamples {
  constructor(private readonly subscriptionPlanService: SubscriptionPlanService) {}

  /**
   * Example 1: Default behavior (backward compatible)
   * Returns active plans ordered by price ASC
   */
  async getDefaultPlans() {
    return await this.subscriptionPlanService.findAll();
  }

  /**
   * Example 2: Filter by specific criteria
   * Find all yearly plans that are active
   */
  async getYearlyPlans() {
    const queryOptions: ISubscriptionPlanQueryOptions = {
      where: {
        billing_cycle: BillingCycle.YEARLY,
        is_active: true
      }
    };
    return await this.subscriptionPlanService.findAll(queryOptions);
  }

  /**
   * Example 3: Custom ordering
   * Get plans ordered by name in descending order
   */
  async getPlansByNameDesc() {
    const queryOptions: ISubscriptionPlanQueryOptions = {
      orderBy: {
        field: 'name',
        direction: 'DESC'
      }
    };
    return await this.subscriptionPlanService.findAll(queryOptions);
  }

  /**
   * Example 4: Complex query with multiple filters and custom ordering
   * Find monthly plans with specific price, ordered by creation date
   */
  async getMonthlyPlansWithPrice(price: number) {
    const queryOptions: ISubscriptionPlanQueryOptions = {
      where: {
        billing_cycle: BillingCycle.MONTHLY,
        price: price,
        is_active: true
      },
      orderBy: {
        field: 'created_at',
        direction: 'DESC'
      }
    };
    return await this.subscriptionPlanService.findAll(queryOptions);
  }

  /**
   * Example 5: Include inactive plans using dedicated method
   * Get all plans including inactive ones, ordered by update date
   */
  async getAllPlansIncludingInactive() {
    const queryOptions: ISubscriptionPlanQueryOptions = {
      orderBy: {
        field: 'updated_at',
        direction: 'DESC'
      }
    };
    return await this.subscriptionPlanService.findAllIncludeInactive(queryOptions);
  }

  /**
   * Example 5b: Default behavior for findAllIncludeInactive
   * Returns all plans (active and inactive) ordered by price ASC
   */
  async getDefaultInactivePlans() {
    return await this.subscriptionPlanService.findAllIncludeInactive();
  }

  /**
   * Example 5c: Filter inactive plans by billing cycle
   * Find all yearly plans including inactive ones
   */
  async getYearlyPlansIncludingInactive() {
    const queryOptions: ISubscriptionPlanQueryOptions = {
      where: {
        billing_cycle: BillingCycle.YEARLY
      }
    };
    return await this.subscriptionPlanService.findAllIncludeInactive(queryOptions);
  }

  /**
   * Example 6: Search by external payment gateway variant ID
   */
  async getPlanByExternalVariantId(variantId: string) {
    const queryOptions: ISubscriptionPlanQueryOptions = {
      where: {
        external_payment_gateway_variant_id: variantId,
        is_active: true
      }
    };
    return await this.subscriptionPlanService.findAll(queryOptions);
  }

  /**
   * Example 7: Filter by price range (you can extend this pattern)
   * Note: For price ranges, you might want to extend the interface to support operators
   */
  async getPlansAtSpecificPrice(targetPrice: number) {
    const queryOptions: ISubscriptionPlanQueryOptions = {
      where: {
        price: targetPrice,
        is_active: true
      },
      orderBy: {
        field: 'price',
        direction: 'ASC'
      }
    };
    return await this.subscriptionPlanService.findAll(queryOptions);
  }
}

/**
 * Usage examples in controller or other services
 */
export class UsageExamples {
  static async demonstrateUsage(service: SubscriptionPlanService) {
    // 1. Default usage (no parameters)
    const defaultPlans = await service.findAll();

    // 2. Custom where clause
    const yearlyPlans = await service.findAll({
      where: { billing_cycle: BillingCycle.YEARLY }
    });

    // 3. Custom ordering
    const plansByName = await service.findAll({
      orderBy: { field: 'name', direction: 'DESC' }
    });

    // 4. Combined filters and ordering
    const monthlyActivePlans = await service.findAll({
      where: { 
        billing_cycle: BillingCycle.MONTHLY, 
        is_active: true 
      },
      orderBy: { field: 'price', direction: 'ASC' }
    });

    // 5. Include inactive plans (default behavior)
    const allPlansIncludeInactive = await service.findAllIncludeInactive();

    // 6. Include inactive plans with custom filtering
    const yearlyPlansIncludeInactive = await service.findAllIncludeInactive({
      where: { billing_cycle: BillingCycle.YEARLY }
    });

    // 7. Include inactive plans with custom ordering
    const allPlansByUpdateDate = await service.findAllIncludeInactive({
      orderBy: { field: 'updated_at', direction: 'DESC' }
    });

    return {
      defaultPlans,
      yearlyPlans,
      plansByName,
      monthlyActivePlans,
      allPlansIncludeInactive,
      yearlyPlansIncludeInactive,
      allPlansByUpdateDate
    };
  }
}