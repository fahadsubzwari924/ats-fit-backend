import { User } from '../../../database/entities/user.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { SubscriptionPlan } from './subscription-plan.entity';
import { Optional } from '@nestjs/common';
import { SubscriptionStatus } from '../enums/subscription-status.enum';



@Entity('subscriptions')
@Index(['lemonSqueezyId'])
@Index(['userId', 'status'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lemon_squeezy_id' })
  lemonSqueezyId: string;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Optional()
  @Column({ length: 3 })
  currency: string;

  @Column({ name: 'starts_at', type: 'timestamp', nullable: true, default: () => 'NOW()' })
  startsAt: Date;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  endsAt: Date;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @Column({ name: 'is_cancelled', type: 'boolean', default: false })
  isCancelled: boolean;

  // User relationship
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Subscription Plan relationship
  @Column({ name: 'subscription_plan_id' })
  subscriptionPlanId: string;

  @ManyToOne(() => SubscriptionPlan, plan => plan.subscriptions, { eager: false })
  @JoinColumn({ name: 'subscription_plan_id' })
  subscriptionPlan: SubscriptionPlan;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', default: () => 'NOW()' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', default: () => 'NOW()' })
  updatedAt: Date;

  // Helper methods
  isActiveSubscription(): boolean {
    return this.status === SubscriptionStatus.ACTIVE && this.isActive;
  }

  isCancelledSubscription(): boolean {
    return this.status === SubscriptionStatus.CANCELLED || this.isCancelled;
  }

  isExpired(): boolean {
    return this.status === SubscriptionStatus.EXPIRED || new Date() > this.endsAt;
  }
}