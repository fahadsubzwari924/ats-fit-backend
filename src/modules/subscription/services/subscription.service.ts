import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '../entities/subscription.entity';
import { SubscriptionStatus } from '../enums/subscription-status.enum';

export interface CreateSubscriptionData {
  lemonSqueezyId: string;
  subscriptionPlanId: string;
  userId: string;
  status: SubscriptionStatus;
  amount: number;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  metadata?: Record<string, any>;
}

export interface UpdateSubscriptionData {
  status?: SubscriptionStatus;
  isActive?: boolean;
  isCancelled?: boolean;
  endsAt?: Date;
  metadata?: Record<string, any>;
}

@Injectable()
export class SubscriptionService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
  ) {}

  async create(data: CreateSubscriptionData): Promise<Subscription> {
    try {
      console.log('🔥 DEBUG: SubscriptionService.create() called with data:', data);
      
      const subscription = this.subscriptionRepository.create({
        lemonSqueezyId: data.lemonSqueezyId,
        subscriptionPlanId: data.subscriptionPlanId,
        userId: data.userId,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        metadata: data.metadata,
        isActive: data.status === SubscriptionStatus.ACTIVE,
        isCancelled: false,
      });
      
      console.log('🔥 DEBUG: Created subscription entity:', subscription);
      console.log('🔥 DEBUG: About to save to database...');
      
      const savedSubscription = await this.subscriptionRepository.save(subscription);
      
      console.log('✅ SUCCESS: Subscription saved to database:', savedSubscription);
      console.log('✅ SUCCESS: Subscription ID:', savedSubscription.id);
      
      return savedSubscription;
    } catch (error) {
      console.error('❌ CRITICAL: Failed to create subscription in database:', error);
      console.error('❌ Error details:', error.message);
      console.error('❌ Error stack:', error.stack);
      
      if (error.code) {
        console.error('❌ Database error code:', error.code);
      }
      if (error.detail) {
        console.error('❌ Database error detail:', error.detail);
      }
      
      throw new BadRequestException(`Failed to create subscription: ${error.message}`);
    }
  }

  async findById(id: string): Promise<Subscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription with ID ${id} not found`);
    }

    return subscription;
  }

  async findByLemonSqueezyId(lemonSqueezyId: string): Promise<Subscription | null> {
    return await this.subscriptionRepository.findOne({
      where: { lemonSqueezyId },
    });
  }

  async findByUserId(userId: string): Promise<Subscription[]> {
    return await this.subscriptionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findActiveByUserId(userId: string): Promise<Subscription | null> {
    return await this.subscriptionRepository.findOne({
      where: { 
        userId, 
        isActive: true,
        isCancelled: false 
      },
      order: { createdAt: 'DESC' },
    });
  }

  async update(id: string, data: UpdateSubscriptionData): Promise<Subscription> {
    const subscription = await this.findById(id);
    
    Object.assign(subscription, data);
    
    return await this.subscriptionRepository.save(subscription);
  }

  async updateByLemonSqueezyId(lemonSqueezyId: string, data: UpdateSubscriptionData): Promise<Subscription> {
    const subscription = await this.findByLemonSqueezyId(lemonSqueezyId);
    
    if (!subscription) {
      throw new NotFoundException(`Subscription with LemonSqueezy ID ${lemonSqueezyId} not found`);
    }
    
    Object.assign(subscription, data);
    
    return await this.subscriptionRepository.save(subscription);
  }

  async cancel(id: string): Promise<Subscription> {
    return await this.update(id, {
      status: SubscriptionStatus.CANCELLED,
      isActive: false,
      isCancelled: true,
    });
  }

  async activate(id: string): Promise<Subscription> {
    return await this.update(id, {
      status: SubscriptionStatus.ACTIVE,
      isActive: true,
      isCancelled: false,
    });
  }

  async delete(id: string): Promise<void> {
    const result = await this.subscriptionRepository.delete(id);
    
    if (result.affected === 0) {
      throw new NotFoundException(`Subscription with ID ${id} not found`);
    }
  }

  async countByUserId(userId: string): Promise<number> {
    return await this.subscriptionRepository.count({
      where: { userId },
    });
  }

  async isUserSubscribed(userId: string): Promise<boolean> {
    const activeSubscription = await this.findActiveByUserId(userId);
    return !!activeSubscription;
  }
}