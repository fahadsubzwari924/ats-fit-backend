import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { PaymentHistory } from './payment-history.entity';
import { UserSubscription } from './user-subscription.entity';
import { BillingCycle } from '../../modules/subscription/enums';

@Entity('subscription_plans')
@Index(['payment_gateway_variant_id'], { unique: true })
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'plan_name' })
  plan_name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ length: 3 })
  currency: string;

  @Column({ name: 'payment_gateway_variant_id', unique: true })
  payment_gateway_variant_id: string;

  @Column({ name: 'is_active', default: true })
  is_active: boolean;

  @Column({ type: 'jsonb', nullable: true })
  features: string[];

  @Column({
    name: 'billing_cycle',
    type: 'enum',
    enum: BillingCycle,
    nullable: true,
  })
  billing_cycle: BillingCycle;

  // Relationships
  @OneToMany(() => PaymentHistory, (payment) => payment.subscription_plan)
  payment_history: PaymentHistory[];

  @OneToMany(
    () => UserSubscription,
    (subscription) => subscription.subscription_plan,
  )
  subscriptions: UserSubscription[];

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;
}
