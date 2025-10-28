import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SubscriptionPlan } from '../../../database/entities/subscription-plan.entity';
import { Repository } from 'typeorm';
import { BillingCycle } from '../enums';
import {
  ICreateSubscriptionPlanData,
  IUpdateSubscriptionPlanData,
} from '../interfaces/subscription.interface';
import {
  BadRequestException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { SubscriptionPlanValidator } from '../validators/subscription-plan.validator';
import { IdValidator } from '../../../shared/validators/id.validator';
import { OrderByType } from '../../../shared/types/order-by.type';
import { ISubscriptionPlanQueryOptions } from '../interfaces/query.interface';
import { SubscriptionPlanQueryBuilder } from '../utils/query-builder.util';

@Injectable()
export class SubscriptionPlanService {
  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlanRepository: Repository<SubscriptionPlan>,
  ) {}

  async create(data: ICreateSubscriptionPlanData): Promise<SubscriptionPlan> {
    // Validate input data using dedicated validator
    SubscriptionPlanValidator.validateCreateData(data);

    // Sanitize and prepare data
    const sanitizedData = SubscriptionPlanValidator.sanitizeCreateData(data);

    try {
      const subscriptionPlan = this.subscriptionPlanRepository.create({
        ...sanitizedData,
        billing_cycle: sanitizedData.billing_cycle || BillingCycle.MONTHLY,
      });

      return await this.subscriptionPlanRepository.save(subscriptionPlan);
    } catch (error) {
      throw new BadRequestException(
        'Failed to create subscription plan',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Find all subscription plans with dynamic query options
   * @param queryOptions Optional query parameters for filtering and ordering
   * @returns Array of subscription plans matching the criteria
   *
   * @example
   * // Default behavior (backward compatible)
   * const plans = await service.findAll();
   *
   * // Custom where clause
   * const activePlans = await service.findAll({
   *   where: { is_active: true, billing_cycle: BillingCycle.YEARLY }
   * });
   *
   * // Custom ordering
   * const plansByName = await service.findAll({
   *   orderBy: { field: 'name', direction: 'DESC' }
   * });
   *
   * // Complex query
   * const complexQuery = await service.findAll({
   *   where: { is_active: true, price: 99.99 },
   *   orderBy: { field: 'created_at', direction: 'DESC' }
   * });
   */
  async findAll(
    queryOptions: ISubscriptionPlanQueryOptions = {},
  ): Promise<SubscriptionPlan[]> {
    try {
      // Validate input parameters
      SubscriptionPlanQueryBuilder.validateQueryOptions(queryOptions);

      // Build TypeORM query options with defaults applied
      const findOptions =
        SubscriptionPlanQueryBuilder.buildFindOptions(queryOptions);

      // Execute query
      return await this.subscriptionPlanRepository.find(findOptions);
    } catch (error) {
      // Re-throw validation errors (BadRequestException)
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Handle unexpected errors
      throw new BadRequestException(
        'Failed to retrieve subscription plans with provided query parameters',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  /**
   * Find all subscription plans including inactive ones with dynamic query options
   * @param queryOptions Optional query parameters for filtering and ordering
   * @returns Array of subscription plans matching the criteria (including inactive ones)
   *
   * @example
   * // Default behavior (backward compatible) - includes inactive plans
   * const allPlans = await service.findAllIncludeInactive();
   *
   * // Custom where clause including inactive plans
   * const yearlyPlans = await service.findAllIncludeInactive({
   *   where: { billing_cycle: BillingCycle.YEARLY }
   * });
   *
   * // Custom ordering including inactive plans
   * const plansByName = await service.findAllIncludeInactive({
   *   orderBy: { field: 'name', direction: 'DESC' }
   * });
   *
   * // Complex query including inactive plans
   * const complexQuery = await service.findAllIncludeInactive({
   *   where: { price: 99.99, billing_cycle: BillingCycle.MONTHLY },
   *   orderBy: { field: 'created_at', direction: 'DESC' }
   * });
   */
  async findAllIncludeInactive(
    queryOptions: ISubscriptionPlanQueryOptions = {},
  ): Promise<SubscriptionPlan[]> {
    try {
      // Validate input parameters using existing infrastructure
      SubscriptionPlanQueryBuilder.validateQueryOptions(queryOptions);

      // Override default behavior to include inactive plans
      // Remove is_active filter from where clause if not explicitly set
      const modifiedOptions: ISubscriptionPlanQueryOptions = {
        ...queryOptions,
        where: {
          ...queryOptions.where,
          // Don't filter by is_active - this allows both active and inactive plans
        },
        // Keep custom orderBy or use default (price: ASC)
        orderBy: queryOptions.orderBy || { field: 'price', direction: 'ASC' },
        includeInactive: true, // Explicitly mark this as including inactive
      };

      // Build TypeORM query options with defaults applied, but without is_active filter
      const findOptions =
        SubscriptionPlanQueryBuilder.buildFindOptions(modifiedOptions);

      // Remove is_active from where clause if it exists (to include inactive plans)
      if (
        findOptions.where &&
        typeof findOptions.where === 'object' &&
        'is_active' in findOptions.where
      ) {
        delete (findOptions.where as any).is_active;
      }

      // Execute query
      return await this.subscriptionPlanRepository.find(findOptions);
    } catch (error) {
      // Re-throw validation errors (BadRequestException)
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Handle unexpected errors
      throw new BadRequestException(
        'Failed to retrieve subscription plans (including inactive) with provided query parameters',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  async findById(id: string): Promise<SubscriptionPlan> {
    const validatedId = IdValidator.validateId(id, 'Subscription plan ID');

    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id: validatedId },
    });

    IdValidator.validateAndThrowNotFound(
      plan,
      validatedId,
      'Subscription plan',
    );
    return plan!;
  }

  async findByVariantId(
    variantId: string,
  ): Promise<SubscriptionPlan | null> {
    const validatedVariantId = IdValidator.validateId(
      variantId,
      'Payment gateway variant ID',
    );

    return await this.subscriptionPlanRepository.findOne({
      where: { payment_gateway_variant_id: validatedVariantId },
    });
  }

  async update(
    id: string,
    data: IUpdateSubscriptionPlanData,
  ): Promise<SubscriptionPlan> {
    const plan = await this.findById(id);

    Object.assign(plan, data);

    return await this.subscriptionPlanRepository.save(plan);
  }

  async activate(id: string): Promise<SubscriptionPlan> {
    return await this.update(id, { is_active: true });
  }

  async deactivate(id: string): Promise<SubscriptionPlan> {
    return await this.update(id, { is_active: false });
  }

  async delete(id: string): Promise<void> {
    const validatedId = IdValidator.validateId(id, 'Subscription plan ID');

    const result = await this.subscriptionPlanRepository.delete(validatedId);

    if (result.affected === 0) {
      throw new NotFoundException(
        `Subscription plan with ID ${validatedId} not found`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      );
    }
  }

  async findByBillingCycle(
    billingCycle: BillingCycle,
    orderBy: OrderByType = 'ASC',
  ): Promise<SubscriptionPlan[]> {
    return await this.subscriptionPlanRepository.find({
      where: {
        billing_cycle: billingCycle,
        is_active: true,
      },
      order: { price: orderBy },
    });
  }
}
