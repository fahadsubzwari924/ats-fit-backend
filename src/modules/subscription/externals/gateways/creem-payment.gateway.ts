import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IPaymentGateway,
  CreateCheckoutRequest,
  CheckoutResponse,
  SubscriptionInfo,
  CustomerPortalRequest,
  CustomerPortalResponse,
  CancelSubscriptionRequest,
  CancelSubscriptionResponse,
  WebhookHeaders,
} from '../interfaces/payment-gateway.interface';
import { NormalizedWebhookEvent } from '../interfaces/normalized-webhook-event.interface';
import {
  CreemService,
  CreateCreemCheckoutSessionOptions,
} from '../services/creem.service';
import {
  CreemSubscription,
  CREEM_STATUS_MAP,
} from '../models/creem-subscription.model';
import {
  BadRequestException,
  CustomHttpException,
  NotFoundException,
} from '../../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../../shared/constants/error-codes';
import { IdValidator } from '../../../../shared/validators/id.validator';
import { PaymentProvider } from '../../enums/payment-provider.enum';
import { SubscriptionStatus } from '../../enums/subscription-status.enum';
import { CreemWebhookVerifier } from '../webhooks/creem-webhook-verifier';
import { CreemWebhookParser } from '../webhooks/creem-webhook-parser';

/**
 * `IPaymentGateway` implementation for Creem. Delegates every Creem SDK call
 * to `CreemService` — this file must never import from the `creem` npm
 * package directly (enforced by a repo gate); see `creem.service.ts`'s
 * header comment for why.
 *
 * Webhook verification/parsing (`verifyWebhookSignature`, `parseWebhook`,
 * Task 6) are thin delegations to `CreemWebhookVerifier`/`CreemWebhookParser`
 * — both static, dependency-free classes so the real HMAC/parsing logic is
 * unit-testable without mocking this gateway.
 */
@Injectable()
export class CreemPaymentGateway implements IPaymentGateway {
  private readonly logger = new Logger(CreemPaymentGateway.name);

  constructor(
    private readonly creemService: CreemService,
    private readonly configService: ConfigService,
  ) {}

  getProviderName(): PaymentProvider {
    return PaymentProvider.CREEM;
  }

  async createCheckout(
    request: CreateCheckoutRequest,
  ): Promise<CheckoutResponse> {
    try {
      const sanitizedRequest = this.validateAndSanitizeCheckoutRequest(request);

      const checkout = await this.creemService.createCheckoutSession(
        this.buildCreemCheckoutOptions(sanitizedRequest),
      );

      this.logger.log(
        `Successfully created Creem checkout for productId: ${sanitizedRequest.variantId}`,
      );

      return this.buildCheckoutResponse(checkout);
    } catch (error) {
      // Repo exceptions (from validation here, or already-typed exceptions
      // thrown by CreemService) must propagate untouched — re-wrapping them
      // would lose the accurate status/error code CreemService worked out
      // from the SDK error. Only genuinely unexpected errors get wrapped.
      if (error instanceof CustomHttpException) {
        throw error;
      }

      this.logger.error('Failed to create Creem checkout', {
        error: error?.message,
        variantId: request?.variantId,
        stack: error?.stack,
      });

      throw new BadRequestException(
        `Creem checkout creation failed: ${error?.message}`,
        ERROR_CODES.CHECKOUT_SESSION_CREATION_FAILED,
      );
    }
  }

  /**
   * Validates and sanitizes the incoming checkout request.
   * Mirrors the validation the outgoing LemonSqueezy gateway performed
   * (that file was removed in Task 11).
   */
  private validateAndSanitizeCheckoutRequest(
    request: CreateCheckoutRequest,
  ): CreateCheckoutRequest {
    if (!request || typeof request !== 'object') {
      throw new BadRequestException(
        'Checkout request is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    if (
      !request.variantId ||
      typeof request.variantId !== 'string' ||
      request.variantId.trim() === ''
    ) {
      throw new BadRequestException(
        'Variant ID is required and must be a non-empty string',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const sanitizedVariantId = request.variantId.trim();

    this.logger.log(
      `Creating checkout with Creem for productId: ${sanitizedVariantId}`,
    );

    return {
      ...request,
      variantId: sanitizedVariantId,
    };
  }

  /**
   * Maps the gateway-agnostic checkout request onto `CreemService`'s options
   * shape: `variantId` -> `productId`, `customData` -> `metadata`,
   * `discountCode` -> `discountCode` (unchanged), `redirectUrl` -> `successUrl`.
   */
  private buildCreemCheckoutOptions(
    request: CreateCheckoutRequest,
  ): CreateCreemCheckoutSessionOptions {
    return {
      productId: request.variantId,
      ...(request.email ? { email: request.email } : {}),
      ...(request.customData ? { metadata: request.customData } : {}),
      ...(request.discountCode ? { discountCode: request.discountCode } : {}),
      ...(request.redirectUrl ? { successUrl: request.redirectUrl } : {}),
    };
  }

  /**
   * `CheckoutEntity.checkoutUrl` is `string | undefined` on the SDK type —
   * `CreemService` only logs a warning when it's missing. It IS fatal here: a
   * checkout response without a URL is useless to the frontend caller.
   */
  private buildCheckoutResponse(checkout: {
    id: string;
    checkoutUrl?: string;
  }): CheckoutResponse {
    if (!checkout.checkoutUrl) {
      throw new BadRequestException(
        `Creem checkout ${checkout.id} was created without a checkoutUrl`,
        ERROR_CODES.CHECKOUT_SESSION_CREATION_FAILED,
      );
    }

    return {
      checkoutUrl: checkout.checkoutUrl,
      checkoutId: checkout.id,
      paymentProvider: PaymentProvider.CREEM,
    };
  }

  async getSubscription(subscriptionId: string): Promise<SubscriptionInfo> {
    try {
      const validatedSubscriptionId = IdValidator.validateId(
        subscriptionId,
        'Subscription ID',
      );

      this.logger.log(
        `Getting Creem subscription details for ID: ${validatedSubscriptionId}`,
      );

      const subscription = await this.creemService.getSubscription(
        validatedSubscriptionId,
      );

      return new CreemSubscription(subscription);
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to get Creem subscription: ${subscriptionId}`,
        error,
      );

      throw new NotFoundException(
        `Failed to retrieve subscription: ${error?.message}`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      );
    }
  }

  async cancelSubscription(
    request: CancelSubscriptionRequest,
  ): Promise<CancelSubscriptionResponse> {
    try {
      const validatedSubscriptionId =
        this.validateCancelSubscriptionRequest(request);

      // Product decision: cancelling keeps access until period end, so we
      // always cancel in 'scheduled' mode, never 'immediate'.
      const result = await this.creemService.cancelSubscription(
        validatedSubscriptionId,
        'scheduled',
      );

      this.logger.log(
        `Successfully scheduled cancellation for Creem subscription: ${validatedSubscriptionId}`,
      );

      return this.buildCancelSubscriptionResponse(
        validatedSubscriptionId,
        result,
      );
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to cancel Creem subscription: ${request?.subscriptionId}`,
        error,
      );

      throw new BadRequestException(
        `Failed to cancel subscription: ${error?.message}`,
        ERROR_CODES.FAILED_TO_CANCEL_SUBSCRIPTION,
      );
    }
  }

  private validateCancelSubscriptionRequest(
    request: CancelSubscriptionRequest,
  ): string {
    if (!request || typeof request !== 'object') {
      throw new BadRequestException(
        'Cancel subscription request is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return IdValidator.validateId(request.subscriptionId, 'Subscription ID');
  }

  private buildCancelSubscriptionResponse(
    subscriptionId: string,
    subscription: {
      status: string;
      canceledAt?: Date | null;
      currentPeriodEndDate?: Date | null;
    },
  ): CancelSubscriptionResponse {
    return {
      subscriptionId,
      status:
        CREEM_STATUS_MAP.get(subscription.status) ?? SubscriptionStatus.EXPIRED,
      cancelledAt: subscription.canceledAt
        ? new Date(subscription.canceledAt)
        : new Date(),
      endsAt: subscription.currentPeriodEndDate
        ? new Date(subscription.currentPeriodEndDate)
        : undefined,
    };
  }

  async createCustomerPortal(
    request: CustomerPortalRequest,
  ): Promise<CustomerPortalResponse> {
    try {
      const validatedCustomerId = this.validateCustomerPortalRequest(request);

      const portalUrl =
        await this.creemService.getCustomerBillingLink(validatedCustomerId);

      return this.buildCustomerPortalResponse(portalUrl);
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to create Creem customer portal: ${request?.customerId}`,
        error,
      );

      throw new BadRequestException(
        `Failed to create customer portal: ${error?.message}`,
        ERROR_CODES.CUSTOMER_PORTAL_URL_CREATION_FAILED,
      );
    }
  }

  private validateCustomerPortalRequest(
    request: CustomerPortalRequest,
  ): string {
    if (!request || typeof request !== 'object') {
      throw new BadRequestException(
        'Customer portal request is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return IdValidator.validateId(request.customerId, 'Customer ID');
  }

  /**
   * Creem's `CustomerLinksEntity` carries
   * no expiration field (`docs/specs/creem-sdk-surface.md` § "Customer
   * billing/portal link") — `expiresAt` is left undefined rather than
   * inventing one, per this task's "do not invent unknown facts" guidance.
   */
  private buildCustomerPortalResponse(
    portalUrl: string,
  ): CustomerPortalResponse {
    return {
      portalUrl,
    };
  }

  async getCustomerSubscriptions(
    customerId: string,
  ): Promise<SubscriptionInfo[]> {
    const validatedCustomerId = IdValidator.validateId(
      customerId,
      'Customer ID',
    );

    // Not implemented against the SDK yet — unused today, out of scope for
    // this task — unused today, kept as an explicit no-op.
    this.logger.warn(
      `Creem getCustomerSubscriptions not implemented for: ${validatedCustomerId}`,
    );

    return [];
  }

  /**
   * Delegates to `CreemWebhookVerifier`, a static/dependency-free class
   * (Task 6). This gateway's only job here is reading the configured
   * secret — `CREEM_WEBHOOK_SECRET` is not wired into `.env` until Task 11,
   * so a missing secret is the live runtime state between Tasks 6 and 11 and
   * must fail closed, never throw, on this `@Public()` endpoint.
   */
  verifyWebhookSignature(headers: WebhookHeaders, rawBody: string): boolean {
    const secret = this.configService.get<string>('CREEM_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.error(
        'CREEM_WEBHOOK_SECRET not configured — rejecting webhook',
      );
      return false;
    }
    return CreemWebhookVerifier.verify(headers, rawBody, secret);
  }

  /** Delegates to `CreemWebhookParser`, a static/dependency-free class (Task 6). */
  parseWebhook(rawPayload: unknown): NormalizedWebhookEvent {
    return CreemWebhookParser.parse(rawPayload);
  }
}
