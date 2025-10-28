import { BillingCycle } from '../enums';
import { OrderByType } from '../../../shared/types/order-by.type';

/**
 * Allowed fields for filtering subscription plans
 * This ensures type safety and prevents injection attacks
 */
export interface ISubscriptionPlanWhereClause {
  is_active?: boolean;
  billing_cycle?: BillingCycle;
  price?: number;
  name?: string;
  payment_gateway_variant_id?: string;
}

/**
 * Allowed fields for ordering subscription plans
 * Using keyof to ensure only valid entity fields can be used
 */
export type SubscriptionPlanOrderField =
  | 'price'
  | 'name'
  | 'billing_cycle'
  | 'created_at'
  | 'updated_at';

/**
 * Order configuration for subscription plan queries
 */
export interface ISubscriptionPlanOrderBy {
  field: SubscriptionPlanOrderField;
  direction: OrderByType;
}

/**
 * Complete query options for findAll method
 */
export interface ISubscriptionPlanQueryOptions {
  where?: ISubscriptionPlanWhereClause;
  orderBy?: ISubscriptionPlanOrderBy;
  includeInactive?: boolean;
}

/**
 * Default query configuration
 */
export const DEFAULT_SUBSCRIPTION_PLAN_QUERY: Required<ISubscriptionPlanQueryOptions> =
  {
    where: { is_active: true },
    orderBy: { field: 'price', direction: 'ASC' },
    includeInactive: false,
  };
