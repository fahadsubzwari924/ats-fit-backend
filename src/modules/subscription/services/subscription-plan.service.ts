import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SubscriptionPlan } from '../../../database/entities/subscription-plan.entity';
import { Repository } from 'typeorm';
import { BillingCycle } from '../enums';
import { ICreateSubscriptionPlanData, IUpdateSubscriptionPlanData } from '../interfaces/subscription.interface';
import { BadRequestException, NotFoundException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { SubscriptionPlanValidator } from '../validators/subscription-plan.validator';
import { IdValidator } from '../../../shared/validators/id.validator';
import { OrderByType } from '../../../shared/types/order-by.type';


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
        ERROR_CODES.BAD_REQUEST
      );
    }
  }

  async findAll(): Promise<SubscriptionPlan[]> {
    return await this.subscriptionPlanRepository.find({
      where: { is_active: true },
      order: { price: 'ASC' },
    });
  }

  async findAllIncludeInactive(): Promise<SubscriptionPlan[]> {
    return await this.subscriptionPlanRepository.find({
      order: { price: 'ASC' },
    });
  }

  async findById(id: string): Promise<SubscriptionPlan> {
    const validatedId = IdValidator.validateId(id, 'Subscription plan ID');

    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id: validatedId },
    });

    IdValidator.validateAndThrowNotFound(plan, validatedId, 'Subscription plan');
    return plan!;
  }

  async findByExternalVariantId(variantId: string): Promise<SubscriptionPlan | null> {
    const validatedVariantId = IdValidator.validateId(variantId, 'External variant ID');

    return await this.subscriptionPlanRepository.findOne({
      where: { external_payment_gateway_variant_id: validatedVariantId },
    });
  }

  async update(id: string, data: IUpdateSubscriptionPlanData): Promise<SubscriptionPlan> {
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
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND
      );
    }
  }

  async findByBillingCycle(billingCycle: BillingCycle, orderBy: OrderByType = 'ASC'): Promise<SubscriptionPlan[]> {
    return await this.subscriptionPlanRepository.find({
      where: { 
        billing_cycle: billingCycle,
        is_active: true 
      },
      order: { price: orderBy },
    });
  }
}