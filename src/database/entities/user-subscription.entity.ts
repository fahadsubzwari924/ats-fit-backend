import { User } from './user.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { Optional } from '@nestjs/common';
import { SubscriptionStatus } from '../../modules/subscription/enums/subscription-status.enum';
import { SubscriptionPlan } from './subscription-plan.entity';


@Entity('user_subscriptions')
@Index(['external_subscription_id'])
@Index(['user_id', 'status'])
export class UserSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'external_subscription_id' })
  external_subscription_id: string;

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
  starts_at: Date;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: true })
  ends_at: Date;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  is_active: boolean;

  @Column({ name: 'is_cancelled', type: 'boolean', default: false })
  is_cancelled: boolean;

  // User relationship
  @Column({ name: 'user_id' })
  user_id: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Subscription Plan relationship
  @Column({ name: 'subscription_plan_id' })
  subscription_plan_id: string;

  @ManyToOne(() => SubscriptionPlan, plan => plan.subscriptions, { eager: false })
  @JoinColumn({ name: 'subscription_plan_id' })
  subscription_plan: SubscriptionPlan;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', default: () => 'NOW()' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', default: () => 'NOW()' })
  updated_at: Date;

  // Helper methods
  isActiveSubscription(): boolean {
    return this.status === SubscriptionStatus.ACTIVE && this.is_active;
  }

  isCancelledSubscription(): boolean {
    return this.status === SubscriptionStatus.CANCELLED || this.is_cancelled;
  }

  isExpired(): boolean {
    return this.status === SubscriptionStatus.EXPIRED || new Date() > this.ends_at;
  }
}