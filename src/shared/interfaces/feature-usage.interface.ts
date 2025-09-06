export interface IFeatureUsage {
  feature: string;
  allowed: number;
  remaining: number;
  used: number;
  usagePercentage: string;
  resetDate: Date;
}
