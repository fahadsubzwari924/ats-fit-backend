import { User } from './user.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { Optional } from '@nestjs/common';
import { SubscriptionStatus } from '../../modules/subscription/enums/subscription-status.enum';
import { SubscriptionPlan } from './subscription-plan.entity';


@Entity('user_subscriptions')
@Index(['external_payment_gateway_subscription_id'])
@Index(['user_id', 'status'])
@Index(['cancelled_at'])
export class UserSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'external_payment_gateway_subscription_id' })
  external_payment_gateway_subscription_id: string;

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

  @Column({ name: 'starts_at', type: 'timestamp', nullable: false, default: () => 'NOW()' })
  starts_at: Date;

  @Column({ name: 'ends_at', type: 'timestamp', nullable: false })
  ends_at: Date;

  @Column({ name: 'is_active', type: 'boolean', default: false })
  is_active: boolean;

  @Column({ name: 'is_cancelled', type: 'boolean', default: false })
  is_cancelled: boolean;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelled_at: Date;

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

  wasCancelledOn(): Date | null {
    return this.cancelled_at;
  }

  daysSinceCancellation(): number | null {
    if (!this.cancelled_at) return null;
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - this.cancelled_at.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}