import { Injectable } from '@nestjs/common';
import { cancelSubscription, createCheckout, getCustomer, getSubscription, lemonSqueezySetup, NewCheckout } from '@lemonsqueezy/lemonsqueezy.js';

@Injectable()
export class LemonSqueezyService {

    private static isSetup = false;

    constructor() {}

    private setupLemonSqueezy() {
    if (LemonSqueezyService.isSetup) return;

    const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
    if (!apiKey) {
      throw new Error('Missing LEMON_SQUEEZY_API_KEY in .env');
    }

    lemonSqueezySetup({
      apiKey,
      onError: (error) => {
        console.error('Lemon Squeezy SDK Error:', error);
        // Optionally throw or handle
      },
    });

    LemonSqueezyService.isSetup = true;
  }

  async  createCheckoutSession(userId: string, variantId: string, userEmail: string) {
    this.setupLemonSqueezy();

    const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
    if (!storeId) {
      throw new Error('Missing LEMON_SQUEEZY_STORE_ID in .env');
    }

    const attributes: NewCheckout = {
        checkoutData: {
            email: userEmail,
            name: 'Ahsan Alam', // Optional: add real name if available
            custom: { user_id: userId }, // For webhook linking
        },
        productOptions: {
            redirectUrl: 'https://your-app.com/dashboard?payment=success', // Adjust to your success page
            receiptButtonText: 'Go to Dashboard',
        },
        testMode: true
      // Optional: checkout_options: { embed: true, media: false } for embedded if needed

    };

    const response = await createCheckout(storeId, variantId, attributes);

    if (response.error) {
      throw new Error(`Checkout creation failed: ${response.error}`);
    }

    return response?.data; // URL to redirect user to complete payment
  }

  async getSubscriptionDetails(subscriptionId: string) {
    this.setupLemonSqueezy();

    const response = await getSubscription(subscriptionId);

    if (response.error) {
      throw new Error(`Get subscription failed: ${response.error.message}`);
    }

    return response.data?.data.attributes; // Returns subscription data like status, plan, etc.
  }

  async cancelSubscription(subscriptionId: string) {
    this.setupLemonSqueezy();

    const response = await cancelSubscription(subscriptionId);

    if (response.error) {
      throw new Error(`Cancellation failed: ${response.error.message}`);
    }

    return response.data?.data.attributes; // Updated subscription data
  }

  // Bonus: Get Customer Portal URL (for users to manage billing themselves)
  async getCustomerPortalUrl(customerId: string) {
    this.setupLemonSqueezy();

    const response = await getCustomer(customerId);

    if (response.error) {
      throw new Error(`Get customer failed: ${response.error.message}`);
    }

    return response.data?.data?.attributes?.urls?.customer_portal;
  }


}