import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  UseGuards,
  Param,
  Req,
  Logger,
  Headers,
  ParseUUIDPipe,
  RawBodyRequest,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionPlanService } from '../services/subscription-plan.service';
import { PaymentService } from '../../../shared/services/payment.service';
import { PaymentHistoryService } from '../services/payment-history.service';
import { UserService } from '../../user/user.service';
import { CreateSubscriptionDto } from '../dtos/subscription.dto';
import { SubscriptionPlanResponseDto } from '../dtos/subscription-plan.dto';
import { User } from '../../../database/entities/user.entity';
import { SubscriptionPlan } from '../../../database/entities/subscription-plan.entity';
import { CheckoutResponseDto } from '../dtos/checkout-response.dto';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { MESSAGES } from '../../../shared/constants/messages';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { Public } from '../../auth/decorators/public.decorator';
import { NormalizedWebhookEvent } from '../externals/interfaces/normalized-webhook-event.interface';
import { WebhookHeaders } from '../externals/interfaces/payment-gateway.interface';
import { PaymentEventType } from '../enums/payment-event-type.enum';
import { isUUID } from 'class-validator';

@ApiTags('Subscriptions')
@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionController {
  private readonly logger = new Logger(SubscriptionController.name);

  constructor(
    private readonly paymentService: PaymentService, // ✅ Abstract payment interface
    private readonly subscriptionService: SubscriptionService,
    private readonly paymentHistoryService: PaymentHistoryService, // ✅ Payment history handling
    private readonly subscriptionPlanService: SubscriptionPlanService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {}

  @Post('checkout')
  @ApiOperation({ summary: 'Create a checkout session for subscription' })
  @ApiResponse({
    status: 201,
    description: 'Checkout session created successfully',
    type: CheckoutResponseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad request - Invalid plan, inactive plan, or user already has active subscription',
  })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  async createCheckoutSession(
    @Body() createSubscriptionDto: CreateSubscriptionDto,
    @Req() request: RequestWithUserContext,
  ) {
    try {
      // Step 1: Validate and retrieve subscription plan
      const subscriptionPlan = await this.validateAndRetrieveSubscriptionPlan(
        createSubscriptionDto.plan_id,
      );

      // Step 2: Validate user eligibility for new subscription
      await this.validateUserSubscriptionEligibility(
        request?.userContext?.userId,
      );

      // Step 3: Create checkout session with payment service
      const checkoutResponse = await this.createPaymentCheckout(
        subscriptionPlan,
        createSubscriptionDto,
        request?.userContext?.userId,
      );

      return checkoutResponse;
    } catch (error) {
      this.logger.error('createCheckoutSession -> Checkout creation error:', {
        error,
        planId: createSubscriptionDto.plan_id,
        userId: request?.userContext?.userId,
      });

      // Re-throw known exceptions to maintain proper error responses
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Handle unexpected errors
      throw new BadRequestException(
        error?.message || MESSAGES.FAILED_TO_CREATE_CHECKOUT_SESSION,
        ERROR_CODES.CHECKOUT_SESSION_CREATION_FAILED,
      );
    }
  }

  /**
   * Validates and retrieves subscription plan by ID
   * Follows Single Responsibility Principle - only handles plan validation
   *
   * @param planId - The subscription plan ID to validate and retrieve
   * @returns Promise<SubscriptionPlan> - The validated and active subscription plan
   * @throws NotFoundException - When plan is not found
   * @throws BadRequestException - When plan is inactive
   */
  private async validateAndRetrieveSubscriptionPlan(planId: string) {
    // Retrieve subscription plan from database
    const subscriptionPlan =
      await this.subscriptionPlanService.findById(planId);

    // Validate plan exists
    if (!subscriptionPlan) {
      throw new NotFoundException(
        MESSAGES.SUBSCRIPTION_NOT_FOUND,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      );
    }

    // Validate plan is active
    if (!subscriptionPlan.is_active) {
      throw new BadRequestException(
        MESSAGES.SUBSCRIPTION_PLAN_IS_NOT_ACTIVE,
        ERROR_CODES.IN_ACTIVE_SUBSCRIPTION_PLAN,
      );
    }

    this.logger.log(
      `Subscription plan validated successfully: ${subscriptionPlan.id}`,
    );
    return subscriptionPlan;
  }

  /**
   * Validates user eligibility for creating a new subscription
   * Follows Single Responsibility Principle - only handles user subscription eligibility
   *
   * @param userId - The user ID to check for existing active subscriptions
   * @throws BadRequestException - When user already has an active subscription
   */
  private async validateUserSubscriptionEligibility(
    userId: string,
  ): Promise<void> {
    // Retrieve user's existing subscriptions
    const existingSubscriptions =
      await this.subscriptionService.findByUserId(userId);

    // Check for active, non-cancelled subscriptions
    const activeSubscription = existingSubscriptions.find(
      (subscription) => subscription.is_active && !subscription.is_cancelled,
    );

    // Validate user doesn't already have active subscription
    if (activeSubscription) {
      this.logger.warn(
        `User ${userId} attempted to create checkout with existing active subscription: ${activeSubscription.id}`,
      );
      throw new BadRequestException(
        MESSAGES.ACTIVE_SUBSCRIPTION_EXISTS,
        ERROR_CODES.ACTIVE_SUBSCRIPTION_EXISTS,
      );
    }

    this.logger.log(`User eligibility validated successfully: ${userId}`);
  }

  /**
   * Creates checkout session with payment service
   * Follows Single Responsibility Principle - only handles checkout creation
   *
   * @param subscriptionPlan - The validated subscription plan
   * @param createSubscriptionDto - The subscription creation data
   * @param userId - The user ID for the checkout
   * @returns Promise<CheckoutResponse> - The checkout session response
   */
  private async createPaymentCheckout(
    subscriptionPlan: any,
    createSubscriptionDto: CreateSubscriptionDto,
    userId: string,
  ) {
    const checkoutRequest: {
      variantId: string;
      email?: string;
      customData: Record<string, any>;
      discountCode?: string;
    } = {
      variantId: subscriptionPlan.payment_gateway_product_id,
      email: createSubscriptionDto.metadata?.email,
      customData: {
        user_id: userId,
        plan_id: subscriptionPlan.id,
        email: createSubscriptionDto.metadata?.email,
      },
    };

    // Founding rate lock: apply discount code for Pro Monthly plans when user has founding_rate_locked = true
    const isMonthlyPlan =
      subscriptionPlan.billing_cycle?.toLowerCase() === 'monthly';

    if (isMonthlyPlan) {
      try {
        const user = await this.userService.getUserById(userId);
        if (user?.founding_rate_locked === true) {
          const couponCode = this.configService.get<string>(
            'CREEM_FOUNDING_DISCOUNT_CODE',
          );
          if (couponCode) {
            checkoutRequest.discountCode = couponCode;
            this.logger.log(
              `[BetaAccess] Applying founding rate discount for user ${userId}`,
            );
          } else {
            this.logger.warn(
              `[BetaAccess] WARN: CREEM_FOUNDING_DISCOUNT_CODE not configured — founding rate not applied`,
            );
          }
        }
      } catch (err) {
        // Non-fatal: log and continue without discount rather than blocking checkout
        this.logger.warn(
          `[BetaAccess] Could not load user for founding rate check: ${err?.message}`,
        );
      }
    }

    this.logger.log(
      `Creating checkout session for user ${userId} with plan ${subscriptionPlan.id}`,
    );

    return await this.paymentService.createCheckout(checkoutRequest);
  }

  @Get('subscriptions/:id')
  @ApiOperation({ summary: 'Get subscription details from database by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the subscription details from database',
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  @ApiResponse({ status: 400, description: 'Invalid subscription ID' })
  async getSubscriptionById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: RequestWithUserContext,
  ) {
    try {
      this.logger.log(`Retrieving subscription details for ID: ${id}`);

      // Get subscription from database
      const subscription = await this.subscriptionService.findById(id);

      if (!subscription) {
        this.logger.warn(`Subscription not found for ID: ${id}`);
        throw new NotFoundException(
          'Subscription not found',
          ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
        );
      }

      // IDOR guard: caller supplies an arbitrary subscription id — verify it
      // belongs to the authenticated caller before returning it.
      if (subscription.user_id !== request?.userContext?.userId) {
        this.logger.warn(
          `User ${request?.userContext?.userId} attempted to access subscription ${id} owned by ${subscription.user_id}`,
        );
        throw new ForbiddenException(
          'You do not own this subscription',
          ERROR_CODES.FORBIDDEN,
        );
      }

      this.logger.log(
        `Subscription retrieved successfully: ${subscription.id}`,
      );
      return subscription;
    } catch (error) {
      this.logger.error(
        'getSubscriptionById -> Error retrieving subscription:',
        {
          error: error.message,
          subscriptionId: id,
          userId: request?.userContext?.userId,
          stack: error.stack,
        },
      );

      // Re-throw known exceptions to maintain proper error responses
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Handle unexpected errors (database connection issues, etc.)
      throw new BadRequestException(
        'Failed to retrieve subscription details',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  @Get('user/subscriptions/:userId')
  @ApiOperation({ summary: 'Get all subscriptions for a user from database' })
  @ApiResponse({
    status: 200,
    description: 'Returns user subscriptions from database',
  })
  @ApiResponse({ status: 400, description: 'Invalid user ID' })
  async getUserSubscriptions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: RequestWithUserContext,
  ) {
    try {
      // IDOR guard: caller supplies an arbitrary userId — only the
      // authenticated caller's own subscriptions may be returned.
      if (userId !== request?.userContext?.userId) {
        this.logger.warn(
          `User ${request?.userContext?.userId} attempted to access subscriptions for user ${userId}`,
        );
        throw new ForbiddenException(
          'You do not own this resource',
          ERROR_CODES.FORBIDDEN,
        );
      }

      this.logger.log(`Retrieving subscriptions for user ID: ${userId}`);

      // Get user subscriptions from database
      const subscriptions = await this.subscriptionService.findByUserId(userId);

      this.logger.log(
        `Retrieved ${subscriptions.length} subscriptions for user: ${userId}`,
      );
      return subscriptions;
    } catch (error) {
      this.logger.error(
        'getUserSubscriptions -> Error retrieving user subscriptions:',
        {
          error: error.message,
          userId,
          requestUserId: request?.userContext?.userId,
          stack: error.stack,
        },
      );

      // Re-throw known exceptions to maintain proper error responses
      if (
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Handle unexpected errors (database connection issues, etc.)
      throw new BadRequestException(
        'Failed to retrieve user subscriptions',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  @Get('user/payment-history/:userId')
  @ApiOperation({ summary: 'Get payment history for a specific user' })
  @ApiResponse({
    status: 200,
    description: 'Returns payment history for the specified user',
  })
  @ApiResponse({ status: 400, description: 'Invalid user ID' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserPaymentHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: RequestWithUserContext,
  ) {
    try {
      // IDOR guard: caller supplies an arbitrary userId — this endpoint
      // leaks customer_email, amounts, and the raw payment_gateway_response,
      // so only the authenticated caller's own history may be returned.
      if (userId !== request?.userContext?.userId) {
        this.logger.warn(
          `User ${request?.userContext?.userId} attempted to access payment history for user ${userId}`,
        );
        throw new ForbiddenException(
          'You do not own this resource',
          ERROR_CODES.FORBIDDEN,
        );
      }

      this.logger.log(`Retrieving payment history for user ID: ${userId}`);

      // Verify user exists
      const user = await this.userService.getUserById(userId);
      if (!user) {
        this.logger.warn(`User not found for ID: ${userId}`);
        throw new NotFoundException(
          'User not found',
          ERROR_CODES.USER_NOT_FOUND,
        );
      }

      // Get payment history from database
      const paymentHistory =
        await this.paymentHistoryService.findByUserId(userId);

      this.logger.log(
        `Retrieved ${paymentHistory?.length || 0} payment history records for user: ${userId}`,
      );

      return paymentHistory || [];
    } catch (error) {
      this.logger.error(
        'getUserPaymentHistory -> Error retrieving payment history:',
        {
          error: error.message,
          userId,
          requestUserId: request?.userContext?.userId,
          stack: error.stack,
        },
      );

      // Re-throw known exceptions to maintain proper error responses
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Handle unexpected errors (database connection issues, etc.)
      throw new BadRequestException(
        'Failed to retrieve payment history',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  @Get('payment-history')
  @ApiOperation({ summary: 'Get payment history for the authenticated user' })
  @ApiResponse({
    status: 200,
    description: 'Returns payment history for the authenticated user',
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async getAuthenticatedUserPaymentHistory(
    @Req() request: RequestWithUserContext,
  ) {
    try {
      const userId = request?.userContext?.userId;

      this.logger.log(
        `Retrieving payment history for authenticated user: ${userId}`,
      );

      // Get payment history from database
      const paymentHistory =
        await this.paymentHistoryService.findByUserId(userId);

      this.logger.log(
        `Retrieved ${paymentHistory?.length || 0} payment history records for authenticated user: ${userId}`,
      );

      return paymentHistory || [];
    } catch (error) {
      this.logger.error(
        'getAuthenticatedUserPaymentHistory -> Error retrieving payment history:',
        {
          error: error.message,
          userId: request?.userContext?.userId,
          stack: error.stack,
        },
      );
      // Handle unexpected errors
      throw new BadRequestException(
        'Failed to retrieve payment history',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  // Subscription Plan Endpoints

  @Get('plans')
  @ApiOperation({ summary: 'Get all active subscription plans' })
  @ApiResponse({
    status: 200,
    description: 'Returns all active subscription plans',
    type: [SubscriptionPlanResponseDto],
  })
  async getSubscriptionPlans() {
    try {
      this.logger.log('Retrieving all active subscription plans');

      // Get all active subscription plans
      const plans = await this.subscriptionPlanService.findAll();

      this.logger.log(`Retrieved ${plans.length} active subscription plans`);
      return plans;
    } catch (error) {
      this.logger.error(
        'getSubscriptionPlans -> Error retrieving subscription plans:',
        {
          error: error.message,
          stack: error.stack,
        },
      );

      // Re-throw known exceptions to maintain proper error responses
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Handle unexpected errors (database connection issues, etc.)
      throw new BadRequestException(
        'Failed to retrieve subscription plans',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get subscription plan by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the subscription plan',
    type: SubscriptionPlanResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  @ApiResponse({ status: 400, description: 'Invalid plan ID' })
  async getSubscriptionPlanById(@Param('id', ParseUUIDPipe) id: string) {
    try {
      this.logger.log(`Retrieving subscription plan for ID: ${id}`);

      // Get subscription plan from database
      const subscriptionPlan = await this.subscriptionPlanService.findById(id);

      if (!subscriptionPlan) {
        this.logger.warn(`Subscription plan not found for ID: ${id}`);
        throw new NotFoundException(
          'Subscription plan not found',
          ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
        );
      }

      this.logger.log(
        `Subscription plan retrieved successfully: ${subscriptionPlan.id}`,
      );
      return subscriptionPlan;
    } catch (error) {
      this.logger.error(
        'getSubscriptionPlanById -> Error retrieving subscription plan:',
        {
          error: error.message,
          planId: id,
          stack: error.stack,
        },
      );

      // Re-throw known exceptions to maintain proper error responses
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Handle unexpected errors (database connection issues, etc.)
      throw new BadRequestException(
        'Failed to retrieve subscription plan details',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }

  @Delete(':id/cancel')
  @ApiOperation({ summary: 'Cancel a user subscription' })
  @ApiResponse({
    status: 200,
    description: 'Subscription cancelled successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Subscription not active or not owned by user',
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async cancelSubscription(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: RequestWithUserContext,
  ) {
    try {
      const userId = request?.userContext?.userId;
      this.logger.log(
        `User ${userId} requesting cancellation of subscription ${id}`,
      );

      const cancelled = await this.subscriptionService.cancelUserSubscription(
        id,
        userId,
      );

      this.logger.log(`Subscription ${id} cancelled successfully`);
      return {
        message: MESSAGES.SUBSCRIPTION_CANCELLED_SUCCESSFULLY,
        subscription: cancelled,
      };
    } catch (error) {
      this.logger.error('cancelSubscription -> error:', {
        error: error.message,
        subscriptionId: id,
        userId: request?.userContext?.userId,
      });

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      throw new BadRequestException(
        MESSAGES.FAILED_TO_CANCEL_SUBSCRIPTION,
        ERROR_CODES.FAILED_TO_CANCEL_SUBSCRIPTION,
      );
    }
  }

  //#region Webhook Controllers

  @Public()
  @Post('payment-confirmation')
  @ApiOperation({ summary: 'Handle payment confirmation notification events' })
  @ApiResponse({
    status: 200,
    description: 'Payment Confirmation processed successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid Payment request' })
  async paymentConfirmation(
    @Headers() headers: WebhookHeaders,
    @Body() payload: unknown,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<void> {
    this.logger.log('🔔 Webhook "payment-confirmation" received');

    // Step 1: Signature verification FIRST, strictly before any DB read or
    // write. Creem's two schemes are keyed off different headers, so the
    // whole header bag is passed through — never a single named header.
    //
    // The raw bytes Creem actually signed must be used verbatim. There is
    // deliberately NO `JSON.stringify(payload)` fallback: re-serialised JSON
    // is never byte-identical to what was signed (key order, spacing,
    // unicode escaping), and "fixing" the resulting mismatches is exactly
    // how a fail-open bug gets introduced. If the raw body is unavailable,
    // reject — using the same generic rejection as a bad signature, so the
    // response never discloses which case occurred.
    if (!req.rawBody) {
      this.rejectWebhook('missing-raw-body');
    }

    const rawBody = req.rawBody.toString('utf8');
    const signatureValid = this.paymentService.verifyWebhookSignature(
      headers,
      rawBody,
    );
    if (!signatureValid) {
      this.rejectWebhook('invalid-signature');
    }

    // Step 2: Parse. This never throws by design — an unrecognised or
    // malformed payload yields PaymentEventType.UNKNOWN, not an exception.
    const event = this.paymentService.parseWebhook(payload);

    try {
      // Step 3: Resolve the entitled user from metadata.user_id — never
      // metadata.email (client-supplied at checkout; the authorization
      // defect this migration exists to close).
      const user = await this.resolveWebhookUser(event);
      if (!user) {
        // payment_history.user_id is NOT NULL with an FK — an insert with
        // no resolved user can never succeed, and a non-200 here would make
        // Creem retry an unfixable event forever on its full retry
        // schedule. Log loudly, acknowledge, do not write payment_history.
        this.logger.error('Webhook user could not be resolved — skipping', {
          eventId: event.eventId,
          gatewayTransactionId: event.gatewayTransactionId,
          gatewayProductId: event.gatewayProductId,
          customerEmail: event.customerEmail,
        });
        return;
      }

      // Audit-only cross-check — NEVER gates or alters processing. Paying
      // with a work card while signed up personally is legitimate.
      if (
        event.customerEmail &&
        user.email &&
        event.customerEmail.toLowerCase() !== user.email.toLowerCase()
      ) {
        this.logger.warn('Webhook customerEmail does not match resolved user', {
          eventId: event.eventId,
          resolvedUserEmail: user.email,
          gatewayCustomerEmail: event.customerEmail,
        });
      }

      // Step 4: Resolve the plan ONCE, here, and pass it through every call
      // below — never let a downstream service independently re-resolve it
      // (two resolution paths for one event is a drift risk between routing
      // and the persisted subscription_plan_id).
      const plan = await this.resolveWebhookPlan(event);

      // Step 5: Atomic claim gate — reserves (or recognises as duplicate)
      // the payment_history row for this transaction before any handler
      // runs.
      const claim = await this.paymentHistoryService.claimPaymentEvent(
        event,
        user,
        plan,
      );

      if (claim.outcome === 'duplicate') {
        this.logger.log(
          `Webhook event ${event.eventId} (transaction ${event.gatewayTransactionId}) is a duplicate — skipping handler`,
        );
        return;
      }

      // Step 6: Route on the normalized event type, then mark processed
      // only once the handler has succeeded. If the handler throws, let it
      // propagate — the row keeps processed_at NULL and Creem's retry
      // legitimately reprocesses it.
      await this.routeWebhookEvent(event, user, plan);
      await this.paymentHistoryService.markAsProcessed(claim.row.id);

      this.logger.log(`✅ Webhook processed: ${event.type} (${event.eventId})`);
    } catch (error) {
      this.logger.error('Webhook processing failed', {
        error: error?.message,
        eventId: event.eventId,
        eventType: event.type,
      });
      throw error;
    }
  }

  /**
   * Every rejection returns the identical 400 status and body regardless of
   * reason. Varying the response by cause (missing headers vs. expired
   * timestamp vs. bad signature vs. malformed body) hands an attacker a
   * feedback channel for refining a forged signature. The real reason is
   * logged only, never echoed to the caller. A non-200 is correct here too
   * — it lets Creem's 30s/1m/5m/1h retry schedule self-heal a transient
   * misconfiguration.
   */
  private rejectWebhook(reason: string): never {
    this.logger.warn(`Webhook rejected: ${reason}`);
    throw new BadRequestException(
      'Invalid webhook request',
      ERROR_CODES.BAD_REQUEST,
    );
  }

  /**
   * Resolve the entitled user for a webhook event.
   *
   * `metadata.user_id` is server-derived at checkout time and authoritative.
   * `metadata.email` is NEVER read here — it is client-supplied at checkout
   * and is the authorization defect this migration exists to close (see
   * "Authorization gap found during the Task 6 security consult"). The only
   * fallback is `event.customerEmail` — Creem's own record of who actually
   * paid — used only when `user_id` is absent or unusable, and always with
   * a warning: this should never fire for a checkout created after the fix.
   *
   * `user_id` is validated as UUID *shape* before it ever reaches the
   * database. `users.id` is a Postgres `uuid` column, so a non-UUID string
   * can never resolve to a row — it's not a "user not found", it's an input
   * that can never succeed. Rejecting it here (rather than letting the
   * lookup throw) means we never have to distinguish "the driver rejected
   * this cast" from "the DB is unreachable" by parsing an error — the
   * distinction is made before the call, not after. A rejection from
   * `getUserById` for a validly-shaped id (e.g. connection failure) is
   * deliberately NOT caught: that's a "could not check right now" failure,
   * and must propagate so Creem's retry schedule gets another chance at it.
   */
  private async resolveWebhookUser(
    event: NormalizedWebhookEvent,
  ): Promise<User | null> {
    const userId = event.metadata?.user_id;
    const hasUserId = typeof userId === 'string' && userId.trim() !== '';

    if (hasUserId) {
      if (!isUUID(userId)) {
        this.logger.error(
          `Webhook metadata.user_id (${userId}) is not a valid UUID (event ${event.eventId}) — falling back to customerEmail`,
        );
      } else {
        const user = await this.userService.getUserById(userId);
        if (!user) {
          this.logger.error(
            `Webhook metadata.user_id (${userId}) did not resolve to an active user (event ${event.eventId})`,
          );
        }
        return user;
      }
    }

    if (event.customerEmail) {
      this.logger.warn(
        `Webhook event ${event.eventId} has no resolvable metadata.user_id — falling back to customerEmail lookup (should never fire for our own checkout)`,
      );
      return this.userService.getUserByEmail(event.customerEmail);
    }

    return null;
  }

  /**
   * Resolve the subscription plan ONCE for this event: `metadata.plan_id`
   * first, falling back to the plan whose `payment_gateway_product_id`
   * matches `event.gatewayProductId`. The result is passed through to both
   * the claim gate and the routed handler — never resolved a second time.
   */
  private async resolveWebhookPlan(
    event: NormalizedWebhookEvent,
  ): Promise<SubscriptionPlan | null> {
    const planId = event.metadata?.plan_id;
    if (typeof planId === 'string' && planId.trim() !== '') {
      try {
        return await this.subscriptionPlanService.findById(planId);
      } catch {
        this.logger.warn(
          `Webhook metadata.plan_id (${planId}) did not resolve to a plan (event ${event.eventId}) — falling back to gatewayProductId`,
        );
      }
    }

    if (event.gatewayProductId) {
      const plan = await this.subscriptionPlanService.findByProductId(
        event.gatewayProductId,
      );
      if (!plan) {
        this.logger.error(
          `No subscription plan found for gatewayProductId ${event.gatewayProductId} (event ${event.eventId})`,
        );
      }
      return plan;
    }

    this.logger.error(
      `Webhook event ${event.eventId} has neither metadata.plan_id nor gatewayProductId — plan cannot be resolved`,
    );
    return null;
  }

  /**
   * Route a claimed webhook event on its normalized type.
   *
   * `PAYMENT_REFUNDED` and `PAYMENT_DISPUTED` are wired here — a security
   * consult found nothing routed to either, and `handlePaymentDisputed` had
   * zero callers despite existing on SubscriptionService.
   */
  private async routeWebhookEvent(
    event: NormalizedWebhookEvent,
    user: User,
    plan: SubscriptionPlan | null,
  ): Promise<void> {
    switch (event.type) {
      case PaymentEventType.SUBSCRIPTION_ACTIVATED:
      case PaymentEventType.SUBSCRIPTION_RENEWED:
      case PaymentEventType.SUBSCRIPTION_TRIALING:
        await this.subscriptionService.handleSuccessfulPayment(
          event,
          user,
          this.requirePlan(event, plan),
        );
        break;

      case PaymentEventType.SUBSCRIPTION_PAYMENT_FAILED:
        await this.subscriptionService.handleFailedPayment(
          event,
          user,
          this.requirePlan(event, plan),
        );
        break;

      case PaymentEventType.SUBSCRIPTION_CANCEL_SCHEDULED:
        await this.subscriptionService.handleCancellationScheduled(event, user);
        break;

      case PaymentEventType.SUBSCRIPTION_CANCELLED:
      case PaymentEventType.SUBSCRIPTION_EXPIRED:
        await this.subscriptionService.handleSubscriptionDeactivated(
          event,
          user,
        );
        break;

      case PaymentEventType.SUBSCRIPTION_UPDATED:
      case PaymentEventType.SUBSCRIPTION_PAUSED:
        await this.subscriptionService.handleSubscriptionUpdated(event);
        break;

      case PaymentEventType.PAYMENT_DISPUTED:
        await this.subscriptionService.handlePaymentDisputed(event, user);
        break;

      case PaymentEventType.PAYMENT_REFUNDED:
        this.logger.log(
          `Refund event ${event.eventId} recorded in payment history only`,
        );
        break;

      case PaymentEventType.UNKNOWN:
      default:
        this.logger.log(
          `Unhandled/unrecognised webhook event type (${event.rawType}) — recorded in history only (event ${event.eventId})`,
        );
        break;
    }
  }

  /**
   * `SUBSCRIPTION_ACTIVATED`/`RENEWED`/`TRIALING` and `PAYMENT_FAILED`
   * cannot be routed without a resolved plan — SubscriptionService's
   * handlers require one. Throwing here (rather than silently skipping the
   * handler) propagates as a non-200 so Creem retries once the underlying
   * data issue — a stale `metadata.plan_id` or an unseeded
   * `gatewayProductId` — is fixed. This is a data-integrity failure, not a
   * signature-verification one, so it is not subject to the no-oracle rule.
   */
  private requirePlan(
    event: NormalizedWebhookEvent,
    plan: SubscriptionPlan | null,
  ): SubscriptionPlan {
    if (!plan) {
      this.logger.error(
        `Cannot route event ${event.eventId} (${event.type}): no subscription plan resolved`,
      );
      throw new InternalServerErrorException(
        'Unable to resolve subscription plan for webhook event',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
    return plan;
  }
  //#endregion
}
