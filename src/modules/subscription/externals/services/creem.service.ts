import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Creem } from 'creem';
import {
  BadRequestException,
  CustomHttpException,
  InternalServerErrorException,
  NotFoundException,
  TooManyRequestsException,
  UnauthorizedException,
} from '../../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../../shared/constants/error-codes';

/**
 * This is the ONLY file in the codebase permitted to import from the `creem`
 * npm package. Everything above it (CreemPaymentGateway, IPaymentGateway,
 * PaymentService, controllers) must stay SDK-agnostic so that if Creem's SDK
 * changes shape, this is the only file that changes.
 *
 * Types below are derived structurally from the `Creem` class itself
 * (`Parameters<...>` / `ReturnType<...>`) rather than imported from
 * `creem/models/components`, because that subpath does not resolve under
 * this repo's current `moduleResolution` (Node10) — see
 * `docs/specs/creem-sdk-surface.md` ("Package entry points").
 */
type CreemClient = InstanceType<typeof Creem>;
type CreateCheckoutRequest = Parameters<CreemClient['checkouts']['create']>[0];
type CheckoutEntity = Awaited<ReturnType<CreemClient['checkouts']['create']>>;
type SubscriptionEntity = Awaited<
  ReturnType<CreemClient['subscriptions']['get']>
>;
type CancelSubscriptionRequestEntity = Parameters<
  CreemClient['subscriptions']['cancel']
>[1];

export interface CreateCreemCheckoutSessionOptions {
  productId: string;
  email?: string;
  metadata?: Record<string, unknown>;
  discountCode?: string;
  successUrl?: string;
}

export type CancelSubscriptionMode = 'scheduled' | 'immediate';

@Injectable()
export class CreemService {
  private readonly logger = new Logger(CreemService.name);
  private client: Creem | undefined;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Creates a checkout session for a product.
   * Docs: docs/specs/creem-sdk-surface.md § "Create checkout"
   */
  async createCheckoutSession(
    options: CreateCreemCheckoutSessionOptions,
  ): Promise<CheckoutEntity> {
    try {
      const request: CreateCheckoutRequest = {
        productId: options.productId,
        successUrl: options.successUrl ?? this.buildSuccessRedirectUrl(),
        ...(options.email ? { customer: { email: options.email } } : {}),
        ...(options.discountCode ? { discountCode: options.discountCode } : {}),
        ...(options.metadata ? { metadata: options.metadata } : {}),
      };

      const checkout = await this.getClient().checkouts.create(request);

      if (!checkout.checkoutUrl) {
        // Legitimately optional per CheckoutEntity.checkoutUrl (string | undefined) —
        // log rather than assume; deciding whether this is fatal is Task 5's concern.
        this.logger.warn(
          `Creem checkout ${checkout.id} was created without a checkoutUrl`,
        );
      }

      return checkout;
    } catch (error) {
      // A repo exception (e.g. missing CREEM_API_KEY from getClient(), or a
      // malformed SUBSCRIPTION_SUCCESS_URL) must propagate untouched, not be
      // relabelled by the generic SDK-error mapping below.
      if (error instanceof CustomHttpException) {
        throw error;
      }

      this.logCreemError('Failed to create Creem checkout session', error, {
        productId: options.productId,
      });

      throw this.mapCreemError(
        error,
        `Checkout session creation failed: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /**
   * Retrieves a subscription by ID.
   * Docs: docs/specs/creem-sdk-surface.md § "Get subscription"
   */
  async getSubscription(subscriptionId: string): Promise<SubscriptionEntity> {
    try {
      return await this.getClient().subscriptions.get(subscriptionId);
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }

      this.logCreemError(
        `Failed to get Creem subscription: ${subscriptionId}`,
        error,
      );

      throw this.mapCreemError(
        error,
        `Failed to retrieve subscription: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /**
   * Cancels a subscription. The mode is required by the SDK — `scheduled`
   * cancels at period end, `immediate` cancels right away.
   * Docs: docs/specs/creem-sdk-surface.md § "Cancel subscription"
   */
  async cancelSubscription(
    subscriptionId: string,
    mode: CancelSubscriptionMode,
  ): Promise<SubscriptionEntity> {
    try {
      const cancelRequest: CancelSubscriptionRequestEntity = { mode };

      return await this.getClient().subscriptions.cancel(
        subscriptionId,
        cancelRequest,
      );
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }

      this.logCreemError(
        `Failed to cancel Creem subscription: ${subscriptionId}`,
        error,
      );

      throw this.mapCreemError(
        error,
        `Subscription cancellation failed: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /**
   * Generates a customer billing/portal link.
   * Docs: docs/specs/creem-sdk-surface.md § "Customer billing/portal link"
   */
  async getCustomerBillingLink(customerId: string): Promise<string> {
    try {
      const response = await this.getClient().customers.generateBillingLinks({
        customerId,
      });

      return response.customerPortalLink;
    } catch (error) {
      if (error instanceof CustomHttpException) {
        throw error;
      }

      this.logCreemError(
        `Failed to generate Creem billing link for customer: ${customerId}`,
        error,
      );

      throw this.mapCreemError(
        error,
        `Failed to generate customer billing link: ${this.extractErrorMessage(error)}`,
      );
    }
  }

  /**
   * Lazily builds the Creem SDK client on first use. `CREEM_API_KEY` is not
   * yet present in any `.env` (added in Task 11), so the client must never
   * be constructed eagerly in the constructor — doing so would make the app
   * unbootable until that task lands.
   */
  private getClient(): Creem {
    if (this.client) {
      return this.client;
    }

    const apiKey = this.configService.get<string>('CREEM_API_KEY');
    if (!apiKey) {
      throw new InternalServerErrorException(
        'Missing CREEM_API_KEY in configuration',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    // Creem uses a different host per mode (not a `testMode` flag).
    const isProd = this.configService.get<string>('NODE_ENV') === 'production';

    this.client = new Creem({
      apiKey,
      server: isProd ? 'prod' : 'test',
    });

    return this.client;
  }

  private buildSuccessRedirectUrl(): string {
    const base =
      this.configService.get<string>('SUBSCRIPTION_SUCCESS_URL') ||
      'http://localhost:4200/billing';
    const url = new URL(base);
    url.searchParams.set('payment', 'success');
    return url.toString();
  }

  /**
   * Maps a raw SDK/transport failure to a repo exception type by HTTP status,
   * not one fixed type per call site — a 401/429/5xx from Creem must not
   * masquerade as a 404, since callers may treat "not found" as
   * "user is unsubscribed" and misfire on a transient blip.
   *
   * `message` is the caller-provided, already-prefixed client-facing message
   * (e.g. "Subscription not found: <sdk message>"); it is never expanded
   * with response `body` here — that only goes into the log payload.
   */
  private mapCreemError(error: unknown, message: string): CustomHttpException {
    const statusCode = this.extractStatusCode(error);

    if (statusCode === 401 || statusCode === 403) {
      return new UnauthorizedException(message, ERROR_CODES.UNAUTHORIZED);
    }
    if (statusCode === 404) {
      return new NotFoundException(message, ERROR_CODES.NOT_FOUND);
    }
    if (statusCode === 429) {
      return new TooManyRequestsException(
        message,
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
      );
    }
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return new BadRequestException(message, ERROR_CODES.BAD_REQUEST);
    }

    // Transport errors (no statusCode) and 5xx both mean "our side can't
    // trust this response" — surface as 500.
    return new InternalServerErrorException(
      message,
      ERROR_CODES.INTERNAL_SERVER,
    );
  }

  /**
   * Logs the full diagnostic picture (status code + response body when
   * available) for operators, per docs/ERROR-HANDLING.md's "preserve the
   * cause chain for operators" — this never leaks into the thrown
   * exception's client-facing message.
   */
  private logCreemError(
    logMessage: string,
    error: unknown,
    context: Record<string, unknown> = {},
  ): void {
    const statusCode = this.extractStatusCode(error);
    const body = this.extractErrorBody(error);

    this.logger.error(logMessage, {
      ...context,
      error: this.extractErrorMessage(error),
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(body !== undefined ? { body } : {}),
    });
  }

  /**
   * Duck-types the SDK's thrown `CreemError.statusCode`. `CreemError` is not
   * importable here — it isn't exported from the package root
   * (`node_modules/creem/dist/commonjs/index.d.ts`), and `creem/models/errors`
   * fails to resolve under this repo's Node10 `moduleResolution` (same issue
   * documented in docs/specs/creem-sdk-surface.md for `creem/webhooks`).
   * Verified shape at
   * `node_modules/creem/dist/commonjs/models/errors/creemerror.d.ts`.
   * Transport errors (ConnectionError, RequestTimeoutError, etc.) have no
   * `statusCode` and correctly fall through to `undefined`.
   */
  private extractStatusCode(error: unknown): number | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof (error as { statusCode: unknown }).statusCode === 'number'
    ) {
      return (error as { statusCode: number }).statusCode;
    }
    return undefined;
  }

  /** Duck-types `CreemError.body`, for operator logs only. */
  private extractErrorBody(error: unknown): string | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'body' in error &&
      typeof (error as { body: unknown }).body === 'string'
    ) {
      return (error as { body: string }).body;
    }
    return undefined;
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return 'Unknown error';
  }
}
