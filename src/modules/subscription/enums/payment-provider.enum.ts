/**
 * Payment Provider Enum
 * 
 * Defines all supported payment gateway providers in the system.
 * This enum ensures type safety and consistency across the application
 * when dealing with different payment providers.
 */
export enum PaymentProvider {
  LEMONSQUEEZY = 'lemonsqueezy',
  STRIPE = 'stripe',
  PADDLE = 'paddle',
  PAYPAL = 'paypal',
}

/**
 * Helper function to get all payment provider values
 */
export const getAllPaymentProviders = (): PaymentProvider[] => {
  return Object.values(PaymentProvider);
};

/**
 * Helper function to check if a string is a valid payment provider
 */
export const isValidPaymentProvider = (provider: string): provider is PaymentProvider => {
  return Object.values(PaymentProvider).includes(provider as PaymentProvider);
};