import { User } from './user.entity';
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PaymentStatus, PaymentType } from '../../modules/subscription/enums';
import { SubscriptionPlan } from './subscription-plan.entity';

@Entity('payment_history')
@Index(['user_id', 'status'])
@Index(['subscription_plan_id', 'created_at'])
export class PaymentHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Unique by design: this is the atomic replay gate for the public webhook
   * endpoint (`INSERT ... ON CONFLICT (payment_gateway_transaction_id)`).
   * The `unique: true` here must stay in sync with the DB constraint
   * `UQ_payment_history_gateway_transaction_id` — without it, a future
   * `migration:generate` diff will propose DROPPING that constraint and
   * silently reopen webhook replay.
   */
  @Column({ name: 'payment_gateway_transaction_id', unique: true })
  payment_gateway_transaction_id: string;

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
  payment_type: PaymentType;

  // User relationship
  @Column({ name: 'user_id' })
  user_id: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // Subscription Plan relationship
  @Column({ name: 'subscription_plan_id', nullable: true })
  subscription_plan_id: string;

  @ManyToOne(() => SubscriptionPlan, (plan) => plan.payment_history, {
    eager: false,
  })
  @JoinColumn({ name: 'subscription_plan_id' })
  subscription_plan: SubscriptionPlan;

  // Complete payment gateway response data
  @Column({ type: 'jsonb', name: 'payment_gateway_response' })
  payment_gateway_response: Record<string, any>;

  // Additional fields for webhook processing
  @Column({ name: 'customer_email', nullable: true })
  customer_email: string;

  @Column({ name: 'is_test_mode', default: false })
  is_test_mode: boolean;

  @Column({ name: 'processed_at', type: 'timestamp', nullable: true })
  processed_at: Date;

  /**
   * Atomic replay-claim gate for the public webhook endpoint. Set to `now()`
   * by the claim UPSERT in `PaymentHistoryService.claimPaymentEvent` when a
   * delivery reserves this row; cleared implicitly once `processed_at` is
   * set. A claim older than 2 minutes is treated as stale/crashed and is
   * reclaimable by the next delivery. See
   * `1815400000000-AddProcessingClaimedAtToPaymentHistory`.
   */
  @Column({
    name: 'processing_claimed_at',
    type: 'timestamp',
    nullable: true,
  })
  processing_claimed_at: Date | null;

  // Error handling
  @Column({ name: 'retry_count', default: 0 })
  retry_count: number;

  @Column({ name: 'last_retry_at', type: 'timestamp', nullable: true })
  last_retry_at: Date;

  @Column({ name: 'processing_error', type: 'text', nullable: true })
  processing_error: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  /**
   * Set when this row's personal fields have been stripped in response to a
   * GDPR erasure request. `NULL` (the default for every existing and newly
   * inserted row) means the row has not been anonymized. Nothing writes to
   * this column yet — the `UserErasureService` that will is a separate,
   * later piece of work; this column exists ahead of it so the schema is
   * ready. See `1815500000000-AddAnonymizedAtToPaymentHistory`.
   */
  @Column({ name: 'anonymized_at', type: 'timestamp', nullable: true })
  anonymized_at: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at: Date;

  // Computed properties from payment gateway response
  get product_name(): string | null {
    return (
      this.payment_gateway_response?.data?.attributes?.product_name || null
    );
  }

  get variant_name(): string | null {
    return (
      this.payment_gateway_response?.data?.attributes?.variant_name || null
    );
  }

  get product_id(): string | null {
    return (
      this.payment_gateway_response?.data?.attributes?.product_id?.toString() ||
      null
    );
  }

  get variant_id(): string | null {
    return (
      this.payment_gateway_response?.data?.attributes?.variant_id?.toString() ||
      null
    );
  }

  get order_id(): string | null {
    return (
      this.payment_gateway_response?.data?.attributes?.order_id?.toString() ||
      null
    );
  }

  // Helper methods
  isSuccessful(): boolean {
    return this.status === PaymentStatus.SUCCESS;
  }

  isFailed(): boolean {
    return this.status === PaymentStatus.FAILED;
  }

  canRetry(): boolean {
    return this.retry_count < 5 && this.status === PaymentStatus.FAILED;
  }

  markAsProcessed(): void {
    this.processed_at = new Date();
  }

  markAsFailed(error: string): void {
    this.status = PaymentStatus.FAILED;
    this.processing_error = error;
    this.retry_count += 1;
    this.last_retry_at = new Date();
  }

  /**
   * Extract any field from the payment gateway response
   */
  getResponseField(path: string): any {
    return this.getNestedValue(this.payment_gateway_response, path);
  }

  /**
   * Helper method to get nested values from JSON
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}
