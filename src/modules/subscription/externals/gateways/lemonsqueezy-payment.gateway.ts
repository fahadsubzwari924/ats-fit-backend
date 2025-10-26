import { Injectable, Logger } from '@nestjs/common';
import {
  IPaymentGateway,
  CreateCheckoutRequest,
  CheckoutResponse,
  SubscriptionInfo,
  CustomerPortalRequest,
  CustomerPortalResponse,
  CancelSubscriptionRequest,
  CancelSubscriptionResponse,
} from '../interfaces/payment-gateway.interface';
import { LemonSqueezyService } from '../services/lemon_squeezy.service';
import { LemonSqueezySubscription } from '../models/lemonsqueezy-subscription.model';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '../../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../../shared/constants/error-codes';
import { IdValidator } from '../../../../shared/validators/id.validator';

@Injectable()
export class LemonSqueezyPaymentGateway implements IPaymentGateway {
  private readonly logger = new Logger(LemonSqueezyPaymentGateway.name);

  constructor(private readonly lemonSqueezyService: LemonSqueezyService) {}

  getProviderName(): string {
    return 'LemonSqueezy';
  }

  async createCheckout(
    request: CreateCheckoutRequest,
  ): Promise<CheckoutResponse> {
    try {
      // Step 1: Validate and sanitize checkout request
      const sanitizedRequest = this.validateAndSanitizeCheckoutRequest(request);

      // Step 2: Create checkout session via LemonSqueezy service
      const checkoutData = await this.lemonSqueezyService.createCheckoutSession(sanitizedRequest);

      // Step 3: Log successful creation
      this.logger.log(
        `Successfully created LemonSqueezy checkout for variant: ${sanitizedRequest.variantId}`,
      );

      // Step 4: Build and return structured response
      return this.buildCheckoutResponse(checkoutData);
    } catch (error) {
      this.logger.error('Failed to create LemonSqueezy checkout', {
        error: error.message,
        variantId: request?.variantId,
        stack: error.stack,
      });

      // Re-throw validation errors (BadRequestException)
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `LemonSqueezy checkout creation failed: ${error.message}`,
        ERROR_CODES.CHECKOUT_SESSION_CREATION_FAILED,
      );
    }
  }

  /**
   * Validates and sanitizes checkout request
   * Follows Single Responsibility Principle - only handles request validation and sanitization
   * 
   * @param request - The checkout request to validate and sanitize
   * @returns CreateCheckoutRequest - The validated and sanitized request object
   * @throws BadRequestException - When request is invalid
   */
  private validateAndSanitizeCheckoutRequest(request: CreateCheckoutRequest): CreateCheckoutRequest {
    // Validate request object exists and is properly typed
    if (!request || typeof request !== 'object') {
      throw new BadRequestException(
        'Checkout request is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate variant ID exists, is string, and not empty
    if (!request.variantId || typeof request.variantId !== 'string' || request.variantId.trim() === '') {
      throw new BadRequestException(
        'Variant ID is required and must be a non-empty string',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const sanitizedVariantId = request.variantId.trim();

    this.logger.log(
      `Creating checkout with LemonSqueezy for variant: ${sanitizedVariantId}`,
    );

    // Return sanitized request object
    return {
      ...request,
      variantId: sanitizedVariantId,
    };
  }

  /**
   * Builds structured checkout response from LemonSqueezy data
   * Follows Single Responsibility Principle - only handles response construction
   * 
   * @param checkoutData - The checkout data from LemonSqueezy service
   * @returns CheckoutResponse - The structured response object
   */
  private buildCheckoutResponse(checkoutData: any): CheckoutResponse {
    return {
      checkoutUrl: checkoutData.data.data.attributes.url,
      checkoutId: checkoutData.data.data.id,
      paymentProvider: 'LemonSqueezy',
    };
  }

  async getSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
    try {
      // Validate subscription ID
      const validatedSubscriptionId = IdValidator.validateId(
        subscriptionId,
        'Subscription ID'
      );

      this.logger.log(
        `Getting LemonSqueezy subscription details for ID: ${validatedSubscriptionId}`,
      );

      const subscription =
        await this.lemonSqueezyService.getSubscriptionDetails(validatedSubscriptionId);

      return new LemonSqueezySubscription(subscription);
    } catch (error) {
      this.logger.error(
        `Failed to get LemonSqueezy subscription: ${subscriptionId}`,
        error,
      );

      // Re-throw validation errors (BadRequestException)
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new NotFoundException(
        `Failed to retrieve subscription: ${error.message}`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      );
    }
  }

  async cancelSubscription(
    request: CancelSubscriptionRequest,
  ): Promise<CancelSubscriptionResponse> {
    try {
      // Step 1: Validate and sanitize cancel subscription request
      const validatedSubscriptionId = this.validateCancelSubscriptionRequest(request);

      // Step 2: Execute cancellation via LemonSqueezy service
      const result = await this.lemonSqueezyService.cancelSubscription(
        validatedSubscriptionId,
      );

      // Step 3: Log successful cancellation
      this.logger.log(
        `Successfully cancelled LemonSqueezy subscription: ${validatedSubscriptionId}`,
      );

      // Step 4: Return structured response
      return this.buildCancelSubscriptionResponse(validatedSubscriptionId, result);
    } catch (error) {
      this.logger.error(
        `Failed to cancel LemonSqueezy subscription: ${request?.subscriptionId}`,
        error,
      );

      // Re-throw validation errors (BadRequestException)
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `Failed to cancel subscription: ${error.message}`,
        ERROR_CODES.FAILED_TO_CANCEL_SUBSCRIPTION,
      );
    }
  }

  /**
   * Validates cancel subscription request and returns validated subscription ID
   * Follows Single Responsibility Principle - only handles request validation
   * 
   * @param request - The cancel subscription request to validate
   * @returns string - The validated and sanitized subscription ID
   * @throws BadRequestException - When request is invalid
   */
  private validateCancelSubscriptionRequest(request: CancelSubscriptionRequest): string {
    // Validate request object exists and is properly typed
    if (!request || typeof request !== 'object') {
      throw new BadRequestException(
        'Cancel subscription request is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate and sanitize subscription ID using existing validator
    const validatedSubscriptionId = IdValidator.validateId(
      request.subscriptionId,
      'Subscription ID'
    );

    // Log validation success
    this.logger.log(
      `Cancelling LemonSqueezy subscription: ${validatedSubscriptionId}`,
    );

    return validatedSubscriptionId;
  }

  /**
   * Builds structured cancel subscription response
   * Follows Single Responsibility Principle - only handles response construction
   * 
   * @param subscriptionId - The validated subscription ID
   * @param lemonSqueezyResult - The result from LemonSqueezy service
   * @returns CancelSubscriptionResponse - The structured response object
   */
  private buildCancelSubscriptionResponse(
    subscriptionId: string,
    lemonSqueezyResult: any,
  ): CancelSubscriptionResponse {
    return {
      subscriptionId,
      status: 'cancelled',
      cancelledAt: new Date(),
      endsAt: lemonSqueezyResult.ends_at ? new Date(lemonSqueezyResult.ends_at) : undefined,
    };
  }

  async createCustomerPortal(
    request: CustomerPortalRequest,
  ): Promise<CustomerPortalResponse> {
    try {
      // Step 1: Validate and sanitize customer portal request
      const validatedCustomerId = this.validateCustomerPortalRequest(request);

      // Step 2: Get portal URL from LemonSqueezy service
      const portalUrl = await this.lemonSqueezyService.getCustomerPortalUrl(
        validatedCustomerId,
      );

      // Step 3: Build and return structured response
      return this.buildCustomerPortalResponse(portalUrl);
    } catch (error) {
      this.logger.error(
        `Failed to create LemonSqueezy customer portal: ${request?.customerId}`,
        error,
      );

      // Re-throw validation errors (BadRequestException)
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `Failed to create customer portal: ${error.message}`,
        ERROR_CODES.CUSTOMER_PORTAL_URL_CREATION_FAILED,
      );
    }
  }

  /**
   * Validates customer portal request and returns validated customer ID
   * Follows Single Responsibility Principle - only handles request validation
   * 
   * @param request - The customer portal request to validate
   * @returns string - The validated customer ID
   * @throws BadRequestException - When request is invalid
   */
  private validateCustomerPortalRequest(request: CustomerPortalRequest): string {
    // Validate request object exists and is properly typed
    if (!request || typeof request !== 'object') {
      throw new BadRequestException(
        'Customer portal request is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate and sanitize customer ID using existing validator
    const validatedCustomerId = IdValidator.validateId(
      request.customerId,
      'Customer ID'
    );

    this.logger.log(
      `Creating LemonSqueezy customer portal for customer: ${validatedCustomerId}`,
    );

    return validatedCustomerId;
  }

  /**
   * Builds structured customer portal response
   * Follows Single Responsibility Principle - only handles response construction
   * 
   * @param portalUrl - The portal URL from LemonSqueezy
   * @returns CustomerPortalResponse - The structured response object
   */
  private buildCustomerPortalResponse(portalUrl: string): CustomerPortalResponse {
    return {
      portalUrl: portalUrl || '',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    };
  }

  async getCustomerSubscriptions(
    customerId: string,
  ): Promise<SubscriptionInfo[]> {
    try {
      // Validate customer ID
      const validatedCustomerId = IdValidator.validateId(
        customerId,
        'Customer ID'
      );

      this.logger.warn(
        `LemonSqueezy getCustomerSubscriptions not implemented for: ${validatedCustomerId}`,
      );
      
      // LemonSqueezy doesn't have a direct method for this, so return empty array
      // This would need to be implemented based on your specific requirements
      return [];
    } catch (error) {
      this.logger.error(
        `Failed to get LemonSqueezy customer subscriptions: ${customerId}`,
        error,
      );

      // Re-throw validation errors (BadRequestException)
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Failed to retrieve customer subscriptions: ${error.message}`,
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  verifyWebhookSignature(signature: string, payload: string): boolean {
    try {
      // Validate signature parameter
      if (!signature || typeof signature !== 'string' || signature.trim() === '') {
        this.logger.warn('Invalid webhook signature provided: signature is required');
        return false;
      }

      // Validate payload parameter
      if (!payload || typeof payload !== 'string') {
        this.logger.warn('Invalid webhook payload provided: payload must be a string');
        return false;
      }

      // LemonSqueezy doesn't have this method in the current service, so return true for now
      // This should be implemented based on LemonSqueezy's webhook signature verification
      this.logger.warn(
        'LemonSqueezy webhook signature verification not implemented',
      );
      return true;
    } catch (error) {
      this.logger.error(
        'Failed to verify LemonSqueezy webhook signature',
        error,
      );
      return false;
    }
  }
}
