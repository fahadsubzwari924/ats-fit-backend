import { BillingCycle } from '../enums';
import { SubscriptionStatus } from '../enums/subscription-status.enum';
import { PaymentEventType } from '../enums/payment-event-type.enum';
import { PlanFeature } from '../../../shared/types/plan-feature.type';

export interface ICreateSubscriptionPlanData {
  plan_name: string;
  description: string;
  price: number;
  currency?: string;
  payment_gateway_product_id: string;
  features?: PlanFeature[];
  billing_cycle?: BillingCycle;
}

export interface IUpdateSubscriptionPlanData {
  plan_name?: string;
  description?: string;
  price?: number;
  currency?: string;
  payment_gateway_product_id?: string;
  features?: PlanFeature[];
  billing_cycle?: BillingCycle;
  is_active?: boolean;
}

export interface ICreateSubscriptionData {
  payment_gateway_subscription_id: string;
  /** Populated from `NormalizedWebhookEvent.gatewayCustomerId` — lets the
   * customer-portal link be generated without parsing a jsonb blob. */
  payment_gateway_customer_id?: string;
  subscription_plan_id: string;
  user_id: string;
  status: SubscriptionStatus;
  amount: number;
  currency: string;
  starts_at: Date;
  ends_at: Date;
  metadata?: Record<string, any>;
}

export interface IUpdateSubscriptionData {
  status?: SubscriptionStatus;
  payment_gateway_customer_id?: string;
  is_active?: boolean;
  is_cancelled?: boolean;
  /** `null` explicitly clears a prior cancellation timestamp — e.g. when a
   * genuine activation event arrives for a row that was previously flagged
   * cancelled, restoring consistency between `is_cancelled` and
   * `cancelled_at`. */
  cancelled_at?: Date | null;
  /** Refreshed from `NormalizedWebhookEvent.periodStart` on renewal — Creem
   * keeps one subscription row across renewals, so this must be refreshed
   * for `ReplacementQuotaService.resolveMonthlyWindow` to reset monthly. */
  starts_at?: Date;
  ends_at?: Date;
  metadata?: Record<string, any>;
}

/**
 * Summary shape returned from `processPaymentGatewayEvent` for the
 * created-or-updated subscription — avoids leaking the full entity through
 * an untyped `any` return.
 */
export interface ISubscriptionSummary {
  subscriptionId: string;
  status: SubscriptionStatus;
  isActive: boolean;
  userId: string;
  subscriptionPlanId: string;
}

export interface IProcessPaymentGatewayEventResult {
  eventType: PaymentEventType;
  subscriptionCreated: boolean;
  subscription: ISubscriptionSummary | null;
}
