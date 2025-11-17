import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Param,
  Req,
  Logger,
  Headers,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionPlanService } from '../services/subscription-plan.service';
import { PaymentService } from '../../../shared/services/payment.service';
import { PaymentHistoryService } from '../services/payment-history.service';
import { UserService } from '../../user/user.service';
import { CreateSubscriptionDto } from '../dtos/subscription.dto';
import { SubscriptionPlanResponseDto } from '../dtos/subscription-plan.dto';
import { CheckoutResponseDto } from '../dtos/checkout-response.dto';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import {
  BadRequestException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { MESSAGES } from '../../../shared/constants/messages';
import { ERROR_CODES } from 'src/shared/constants/error-codes';
import { Public } from '../../auth/decorators/public.decorator';
import { ExternalPaymentGatewayEvents } from '../externals/enums';
import { Inject } from '@nestjs/common';
import { IEmailService, EMAIL_SERVICE_TOKEN } from '../../../shared/interfaces/email.interface';
import { EmailTemplates } from '../../../shared/enums/email-templates.enum';

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
    @Inject(EMAIL_SERVICE_TOKEN) private readonly emailService: IEmailService, // Inject email service via token
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
      await this.validateUserSubscriptionEligibility(request?.userContext?.userId);

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
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
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
    const subscriptionPlan = await this.subscriptionPlanService.findById(planId);

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

    this.logger.log(`Subscription plan validated successfully: ${subscriptionPlan.id}`);
    return subscriptionPlan;
  }

  /**
   * Validates user eligibility for creating a new subscription
   * Follows Single Responsibility Principle - only handles user subscription eligibility
   * 
   * @param userId - The user ID to check for existing active subscriptions
   * @throws BadRequestException - When user already has an active subscription
   */
  private async validateUserSubscriptionEligibility(userId: string): Promise<void> {
    // Retrieve user's existing subscriptions
    const existingSubscriptions = await this.subscriptionService.findByUserId(userId);

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
    const checkoutRequest = {
      variantId: subscriptionPlan.payment_gateway_variant_id,
      email: createSubscriptionDto.metadata?.email,
      customData: {
        userId,
        planId: subscriptionPlan.id,
        email: createSubscriptionDto.metadata?.email,
      },
    };

    this.logger.log(`Creating checkout session for user ${userId} with plan ${subscriptionPlan.id}`);

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

      this.logger.log(`Subscription retrieved successfully: ${subscription.id}`);
      return subscription;
    } catch (error) {
      this.logger.error('getSubscriptionById -> Error retrieving subscription:', {
        error: error.message,
        subscriptionId: id,
        userId: request?.userContext?.userId,
        stack: error.stack,
      });

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
      this.logger.log(`Retrieving subscriptions for user ID: ${userId}`);

      // Get user subscriptions from database
      const subscriptions = await this.paymentHistoryService.findByUserId(userId);

      this.logger.log(`Retrieved ${subscriptions.length} subscriptions for user: ${userId}`);
      return subscriptions;
    } catch (error) {
      this.logger.error('getUserSubscriptions -> Error retrieving user subscriptions:', {
        error: error.message,
        userId,
        requestUserId: request?.userContext?.userId,
        stack: error.stack,
      });


      // Handle unexpected errors (database connection issues, etc.)
      throw new BadRequestException(
        'Failed to retrieve user subscriptions',
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
      this.logger.error('getSubscriptionPlans -> Error retrieving subscription plans:', {
        error: error.message,
        stack: error.stack,
      });

      // Re-throw known exceptions to maintain proper error responses
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
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

      this.logger.log(`Subscription plan retrieved successfully: ${subscriptionPlan.id}`);
      return subscriptionPlan;
    } catch (error) {
      this.logger.error('getSubscriptionPlanById -> Error retrieving subscription plan:', {
        error: error.message,
        planId: id,
        stack: error.stack,
      });

      // Re-throw known exceptions to maintain proper error responses
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      // Handle unexpected errors (database connection issues, etc.)
      throw new BadRequestException(
        'Failed to retrieve subscription plan details',
        ERROR_CODES.BAD_REQUEST,
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
    @Headers('x-signature') signature: string,
    @Body() payload: any,
  ) {
    try {
      this.logger.log(
        '🔔 Payment gateway "payment-confirmation" notification endpoint reached successfully!',
      );
      this.logger.log(
        `🔥 DEBUG: Received "payment-confirmation" notification payload:`,
        payload,
      );

      // Step 1: Get user by email from payload
      const userEmail = payload?.meta?.custom_data?.email;
      
      if (!userEmail) {
        this.logger.warn(
          `🔥 DEBUG: Email not found in payment-confirmation payload`,
        );
        throw new BadRequestException(
          'Email not found in payment payload',
          ERROR_CODES.BAD_REQUEST,
        );
      }

      this.logger.log(`🔥 DEBUG: Looking up user by email: ${userEmail}`);
      const user = await this.userService.getUserByEmail(userEmail);

      if (!user) {
        this.logger.warn(
          `🔥 DEBUG: User not found for email: ${userEmail}`,
        );
        throw new NotFoundException(
          'User not found',
          ERROR_CODES.USER_NOT_FOUND,
        );
      }

      this.logger.log(`🔥 DEBUG: User found - ID: ${user.id}, Name: ${user.full_name}`);

      // Step 2: Process subscription logic (decoupled from payment history)
      let subscriptionResult;
      if (payload.meta?.event_name === ExternalPaymentGatewayEvents.SUBSCRIPTION_PAYMENT_SUCCESS) {
        subscriptionResult = await this.subscriptionService.handleSuccessfulPayment(payload);
      } else {
        subscriptionResult = await this.subscriptionService.handleFailedPayment(payload, user);
      }

      this.logger.log(
        `🔥 DEBUG: Subscription processing result:`,
        subscriptionResult,
      );

      // Step 3: Create payment history record first (audit trail)
      this.logger.log(`🔥 DEBUG: Creating payment history record...`);
      const paymentHistory = await this.paymentHistoryService.paymentConfirmation(payload);
      this.logger.log(`🔥 DEBUG: Payment history created:`, {
        id: paymentHistory.id,
      });

      // Step 4: Verify signature
      if (
        signature &&
        !(await this.subscriptionService.verifySignature(
          signature,
          JSON.stringify(payload),
        ))
      ) {
        await this.paymentHistoryService.markAsFailed(
          paymentHistory.id,
          'Invalid signature',
        );
        throw new BadRequestException(
          'Invalid signature',
          ERROR_CODES.BAD_REQUEST,
        );
      }
      

      // Step 5: Mark payment as processed
      await this.paymentHistoryService.markAsProcessed(paymentHistory.id);


      // Log processing results
      this.logger.log(`🎯 NEW Subscription created in database:`, {
        paymentHistory,
        subscriptionResult,
      });

    } catch (error) {
      this.logger.error(
        'Webhook -> payment-confirmation -> Failed to process payment gateway notification',
        error,
      );
      throw error;
    }
  }
  //#endregion


  @Public()
  @Get('test-email')
  async testEmail() {
    try {
      const response = await this.emailService.send('info@atsfitt.com', {
        templateKey: EmailTemplates.PAYMENT_FAILED,
        templateData: {
          amount: 1000,
          userName: 'Ahsan',
          orderId: '151515151',
        },
        subject: 'Ats Fit Payment Failure Test',
      });
      return response;
    } catch (error) {
      this.logger.error('Failed to send test email:', error);
    }
  }

}
