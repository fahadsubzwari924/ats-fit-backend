import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index } from 'typeorm';
import { PaymentHistory } from '../../webhooks/entities/payment-history.entity';
import { Subscription } from './subscription.entity';

@Entity('subscription_plans')
@Index(['lemonSqueezyVariantId'], { unique: true })
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_name' })
  planName: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ length: 3 })
  currency: string;

  @Column({ name: 'lemon_squeezy_variant_id', unique: true })
  lemonSqueezyVariantId: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', nullable: true })
  features: string[];

  @Column({ name: 'billing_cycle', nullable: true })
  billingCycle: string; // 'monthly', 'yearly', 'weekly'

  // Relationships
  @OneToMany(() => PaymentHistory, payment => payment.subscriptionPlan)
  paymentHistory: PaymentHistory[];

  @OneToMany(() => Subscription, subscription => subscription.subscriptionPlan)
  subscriptions: Subscription[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}