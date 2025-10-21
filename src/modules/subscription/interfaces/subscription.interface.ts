import { BillingCycle } from "../enums";
import { SubscriptionStatus } from "../enums/subscription-status.enum";

export interface ICreateSubscriptionPlanData {
  plan_name: string;
  description: string;
  price: number;
  currency?: string;
  external_payment_gateway_variant_id: string;
  features?: string[];
  billing_cycle?: BillingCycle;
}

export interface IUpdateSubscriptionPlanData {
  plan_name?: string;
  description?: string;
  price?: number;
  currency?: string;
  external_payment_gateway_variant_id?: string;
  features?: string[];
  billing_cycle?: BillingCycle;
  is_active?: boolean;
}


export interface ICreateSubscriptionData {
  external_payment_gateway_subscription_id: string;
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
  is_active?: boolean;
  is_cancelled?: boolean;
  cancelled_at?: Date;
  ends_at?: Date;
  metadata?: Record<string, any>;
}