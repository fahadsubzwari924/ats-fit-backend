import { User } from '../../../database/entities/user.entity';
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { SubscriptionPlan } from '../../subscription/entities/subscription-plan.entity';
import { PaymentStatus, PaymentType } from '../enums/payment.enum';


@Entity('payment_history')
@Index(['lemonSqueezyId'])
@Index(['userId', 'status'])
@Index(['subscriptionPlanId', 'createdAt'])
export class PaymentHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'lemon_squeezy_id'})
  lemonSqueezyId: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ length: 3 })
  currency: string;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({
    type: 'enum',
    enum: PaymentType,
    name: 'payment_type',
  })
  paymentType: PaymentType;

  // User relationship
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Subscription Plan relationship
  @Column({ name: 'subscription_plan_id', nullable: true })
  subscriptionPlanId: string;

  @ManyToOne(() => SubscriptionPlan, plan => plan.paymentHistory, { eager: false })
  @JoinColumn({ name: 'subscription_plan_id' })
  subscriptionPlan: SubscriptionPlan;

  // Complete LemonSqueezy response payload
  @Column({ type: 'jsonb', name: 'lemon_squeezy_payload' })
  lemonSqueezyPayload: Record<string, any>;

  // Additional fields for webhook processing
  @Column({ name: 'customer_email', nullable: true })
  customerEmail: string;

  @Column({ name: 'is_test_mode', default: false })
  isTestMode: boolean;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processedAt: Date;

  // Error handling
  @Column({ name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ name: 'last_retry_at', type: 'timestamp', nullable: true })
  lastRetryAt: Date;

  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processingError: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Computed properties from LemonSqueezy payload
  get productName(): string | null {
    return this.lemonSqueezyPayload?.data?.attributes?.product_name || null;
  }

  get variantName(): string | null {
    return this.lemonSqueezyPayload?.data?.attributes?.variant_name || null;
  }

  get productId(): string | null {
    return this.lemonSqueezyPayload?.data?.attributes?.product_id?.toString() || null;
  }

  get variantId(): string | null {
    return this.lemonSqueezyPayload?.data?.attributes?.variant_id?.toString() || null;
  }

  get orderId(): string | null {
    return this.lemonSqueezyPayload?.data?.attributes?.order_id?.toString() || null;
  }

  // Helper methods
  isSuccessful(): boolean {
    return this.status === PaymentStatus.SUCCESS;
  }

  isFailed(): boolean {
    return this.status === PaymentStatus.FAILED;
  }

  canRetry(): boolean {
    return this.retryCount < 5 && this.status === PaymentStatus.FAILED;
  }

  markAsProcessed(): void {
    this.processedAt = new Date();
  }

  markAsFailed(error: string): void {
    this.status = PaymentStatus.FAILED;
    this.processingError = error;
    this.retryCount += 1;
    this.lastRetryAt = new Date();
  }

  /**
   * Extract any field from the LemonSqueezy payload
   */
  getPayloadField(path: string): any {
    return this.getNestedValue(this.lemonSqueezyPayload, path);
  }

  /**
   * Helper method to get nested values from JSON
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}