import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';

export interface CreateSubscriptionPlanData {
  planName: string;
  description: string;
  price: number;
  currency?: string;
  lemonSqueezyVariantId: string;
  features?: string[];
  billingCycle?: string;
}

export interface UpdateSubscriptionPlanData {
  planName?: string;
  description?: string;
  price?: number;
  currency?: string;
  lemonSqueezyVariantId?: string;
  features?: string[];
  billingCycle?: string;
  isActive?: boolean;
}

@Injectable()
export class SubscriptionPlanService {
  constructor(
    @InjectRepository(SubscriptionPlan)
    private readonly subscriptionPlanRepository: Repository<SubscriptionPlan>,
  ) {}

  async create(data: CreateSubscriptionPlanData): Promise<SubscriptionPlan> {
    try {
      const subscriptionPlan = this.subscriptionPlanRepository.create({
        ...data,
        currency: data.currency || 'USD',
        billingCycle: data.billingCycle || 'monthly',
      });
      
      return await this.subscriptionPlanRepository.save(subscriptionPlan);
    } catch (error) {
      throw new BadRequestException('Failed to create subscription plan');
    }
  }

  async findAll(): Promise<SubscriptionPlan[]> {
    return await this.subscriptionPlanRepository.find({
      where: { isActive: true },
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

  async findByLemonSqueezyVariantId(variantId: string): Promise<SubscriptionPlan | null> {
    return await this.subscriptionPlanRepository.findOne({
      where: { lemonSqueezyVariantId: variantId },
    });
  }

  async update(id: string, data: UpdateSubscriptionPlanData): Promise<SubscriptionPlan> {
    const plan = await this.findById(id);
    
    Object.assign(plan, data);
    
    return await this.subscriptionPlanRepository.save(plan);
  }

  async activate(id: string): Promise<SubscriptionPlan> {
    return await this.update(id, { isActive: true });
  }

  async deactivate(id: string): Promise<SubscriptionPlan> {
    return await this.update(id, { isActive: false });
  }

  async delete(id: string): Promise<void> {
    const result = await this.subscriptionPlanRepository.delete(id);
    
    if (result.affected === 0) {
      throw new NotFoundException(`Subscription plan with ID ${id} not found`);
    }
  }

  async findByBillingCycle(billingCycle: string): Promise<SubscriptionPlan[]> {
    return await this.subscriptionPlanRepository.find({
      where: { 
        billingCycle,
        isActive: true 
      },
      order: { price: 'ASC' },
    });
  }
}