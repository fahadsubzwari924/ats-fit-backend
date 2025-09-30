import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from '../entities/subscription.entity';

export interface CreateSubscriptionData {
  lemonSqueezyId: string;
  planId: string;
  userId: string;
  status: string;
  amount: number;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  trialEndsAt?: Date;
  metadata?: Record<string, any>;
}

export interface UpdateSubscriptionData {
  status?: string;
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
      const subscription = this.subscriptionRepository.create({
        ...data,
        isActive: data.status === 'active',
        isCancelled: false,
      });
      
      return await this.subscriptionRepository.save(subscription);
    } catch (error) {
      throw new BadRequestException('Failed to create subscription');
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
      status: 'cancelled',
      isActive: false,
      isCancelled: true,
    });
  }

  async activate(id: string): Promise<Subscription> {
    return await this.update(id, {
      status: 'active',
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