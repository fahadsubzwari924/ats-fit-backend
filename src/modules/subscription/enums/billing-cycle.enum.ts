/**
 * Billing Cycle Enum
 * 
 * Defines the available billing cycles for subscription plans
 */
export enum BillingCycle {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
  WEEKLY = 'weekly',
}

/**
 * Helper class for working with billing cycles
 */
export class BillingCycleHelper {
  /**
   * Get all billing cycle values
   */
  static getAllCycles(): string[] {
    return Object.values(BillingCycle);
  }

  /**
   * Check if a billing cycle is valid
   */
  static isValidCycle(cycle: string): boolean {
    return Object.values(BillingCycle).includes(cycle as BillingCycle);
  }

  /**
   * Get display name for billing cycle
   */
  static getDisplayName(cycle: BillingCycle): string {
    const displayNames: Record<BillingCycle, string> = {
      [BillingCycle.MONTHLY]: 'Monthly',
      [BillingCycle.YEARLY]: 'Yearly',
      [BillingCycle.WEEKLY]: 'Weekly',
    };
    return displayNames[cycle] || cycle;
  }

  /**
   * Get billing cycle description
   */
  static getDescription(cycle: BillingCycle): string {
    const descriptions: Record<BillingCycle, string> = {
      [BillingCycle.MONTHLY]: 'Billed every month',
      [BillingCycle.YEARLY]: 'Billed every year',
      [BillingCycle.WEEKLY]: 'Billed every week',
    };
    return descriptions[cycle] || `Billed ${cycle}`;
  }
}