/** JSON item in subscription_plans.features (jsonb): line or titled group. */
export interface PlanFeatureGroup {
  title: string;
  subitems: string[];
}

export type PlanFeature = string | PlanFeatureGroup;
