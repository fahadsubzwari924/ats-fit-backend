import { Injectable, Logger } from '@nestjs/common';
import {
  cancelSubscription,
  createCheckout,
  getCustomer,
  getSubscription,
  lemonSqueezySetup,
  NewCheckout,
} from '@lemonsqueezy/lemonsqueezy.js';
import { CreateCheckoutRequest } from '../interfaces/payment-gateway.interface';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '../../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../../shared/constants/error-codes';

@Injectable()
export class LemonSqueezyService {
  private readonly logger = new Logger(LemonSqueezyService.name);
  private static isSetup = false;

  constructor() {}

  async createCheckoutSession(request: CreateCheckoutRequest) {

    const storeId = process.env.LEMON_SQUEEZY_STORE_ID;
    if (!storeId) {
      throw new InternalServerErrorException(
        'Missing LEMON_SQUEEZY_STORE_ID in configuration',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    const attributes: NewCheckout = {
      checkoutData: {
        email: request.email,
        name: request.name, // Optional: add real name if available
        custom: request.customData, // For webhook linking
      },
      productOptions: {
        redirectUrl: process.env.SUBSCRIPTION_SUCCESS_URL, // Adjust to your success page
        receiptButtonText: 'Go to Dashboard',
      },
      testMode: true,
      // Optional: checkout_options: { embed: true, media: false } for embedded if needed
    };

    const response = await createCheckout(
      storeId,
      request.variantId,
      attributes,
    );

    if (response?.error) {
      throw new BadRequestException(
        `Checkout session creation failed: ${response.error}`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return response; // URL to redirect user to complete payment
  }

  async getSubscriptionDetails(subscriptionId: string) {

    const response = await getSubscription(subscriptionId);

    if (response?.error) {
      throw new NotFoundException(
        `Subscription not found: ${response?.error?.message}`,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return response.data?.data.attributes; // Returns subscription data like status, plan, etc.
  }

  async cancelSubscription(subscriptionId: string) {

    const response = await cancelSubscription(subscriptionId);

    if (response?.error) {
      throw new BadRequestException(
        `Subscription cancellation failed: ${response?.error?.message}`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return response.data?.data.attributes; // Updated subscription data
  }

  // Bonus: Get Customer Portal URL (for users to manage billing themselves)
  async getCustomerPortalUrl(customerId: string) {

    const response = await getCustomer(customerId);

    if (response.error) {
      throw new NotFoundException(
        `Customer not found: ${response.error.message}`,
        ERROR_CODES.NOT_FOUND,
      );
    }

    return response.data?.data?.attributes?.urls?.customer_portal;
  }
}
