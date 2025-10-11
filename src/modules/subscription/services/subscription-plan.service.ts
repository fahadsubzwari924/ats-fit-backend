import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SubscriptionPlan } from '../../../database/entities/subscription-plan.entity';
import { Repository } from 'typeorm';
import { BillingCycle } from '../enums';
import { ICreateSubscriptionPlanData, IUpdateSubscriptionPlanData } from '../interfaces/subscription.interface';


@Injectable()
export class SubscriptionPlanService {
  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlanRepository: Repository<SubscriptionPlan>,
  ) {}

  async create(data: ICreateSubscriptionPlanData): Promise<SubscriptionPlan> {
    try {
      const subscriptionPlan = this.subscriptionPlanRepository.create({
        ...data,
        currency: data.currency || 'USD',
        billing_cycle: data.billing_cycle || BillingCycle.MONTHLY,
      });
      
      return await this.subscriptionPlanRepository.save(subscriptionPlan);
    } catch (error) {
      throw new BadRequestException('Failed to create subscription plan');
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
    const plan = await this.subscriptionPlanRepository.findOne({
      where: { id },
    });

    if (!plan) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }

    return plan;
  }

  async findByExternalVariantId(variantId: string): Promise<SubscriptionPlan | null> {
    return await this.subscriptionPlanRepository.findOne({
      where: { external_variant_id: variantId },
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
    const result = await this.subscriptionPlanRepository.delete(id);
    
    if (result.affected === 0) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }
  }

  async findByBillingCycle(billingCycle: BillingCycle): Promise<SubscriptionPlan[]> {
    return await this.subscriptionPlanRepository.find({
      where: { 
        billing_cycle: billingCycle,
        is_active: true 
      },
      order: { price: 'ASC' },
    });
  }
}