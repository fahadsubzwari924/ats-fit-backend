import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  cancelSubscription,
  createCheckout,
  getCustomer,
  getSubscription,
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

  constructor(private readonly configService: ConfigService) {}

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
        ...(request.discountCode ? { discountCode: request.discountCode } : {}),
      },
      productOptions: {
        redirectUrl: this.buildSuccessRedirectUrl(),
        receiptButtonText: 'Go to Dashboard',
      },
      testMode:
        this.configService.get<string>('NODE_ENV', 'development') !==
        'production',
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

  private buildSuccessRedirectUrl(): string {
    const base =
      this.configService.get<string>('SUBSCRIPTION_SUCCESS_URL') ||
      'http://localhost:4200/billing';
    const url = new URL(base);
    url.searchParams.set('payment', 'success');
    return url.toString();
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
