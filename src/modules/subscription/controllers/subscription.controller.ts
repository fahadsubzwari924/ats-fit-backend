import { Controller, Post, Body, Get, UseGuards, Param, Req, Logger, Headers, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionPlanService } from '../services/subscription-plan.service';
import { PaymentService } from '../../../shared/services/payment.service';
import { PaymentHistoryService } from '../services/payment-history.service';
import { CreateSubscriptionDto } from '../dtos/subscription.dto';
import { SubscriptionPlanResponseDto } from '../dtos/subscription-plan.dto';
import { CheckoutResponseDto } from '../dtos/checkout-response.dto';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import { BadRequestException, NotFoundException } from '../../../shared/exceptions/custom-http-exceptions';
import { MESSAGES } from '../../../shared/constants/messages';
import { ERROR_CODES } from 'src/shared/constants/error-codes';
import { Public } from '../../auth/decorators/public.decorator';

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
  ) {}

  @Post('checkout')
  @ApiOperation({ summary: 'Create a checkout session for subscription' })
  @ApiResponse({ 
    status: 201, 
    description: 'Checkout session created successfully',
    type: CheckoutResponseDto
  })
  @ApiResponse({ status: 400, description: 'Bad request - Invalid plan, inactive plan, or user already has active subscription' })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  async createCheckoutSession(
    @Body() createSubscriptionDto: CreateSubscriptionDto,
    @Req() request: RequestWithUserContext,
  ) {
    try {
      // Find the subscription plan by plan_id from the database
      const subscriptionPlan = await this.subscriptionPlanService.findById(createSubscriptionDto.plan_id);
      
      if (!subscriptionPlan) {
        throw new NotFoundException(
          MESSAGES.SUBSCRIPTION_NOT_FOUND,
          ERROR_CODES.SUBSCRIPTION_NOT_FOUND
        );
      }

      if (!subscriptionPlan.is_active) {
        throw new BadRequestException(
          MESSAGES.SUBSCRIPTION_PLAN_IS_NOT_ACTIVE,
          ERROR_CODES.IN_ACTIVE_SUBSCRIPTION_PLAN
        );
      }

      // Check if user already has a valid/active subscription
      const existingSubscriptions = await this.subscriptionService.findByUserId(request?.userContext?.userId);
      const activeSubscription = existingSubscriptions.find(sub => sub.is_active && !sub.is_cancelled);
      
      if (activeSubscription) {
        this.logger.warn(`User ${request?.userContext?.userId} attempted to create checkout with existing active subscription: ${activeSubscription.id}`);
        throw new BadRequestException(
          MESSAGES.ACTIVE_SUBSCRIPTION_EXISTS,
          ERROR_CODES.ACTIVE_SUBSCRIPTION_EXISTS
        );
      }

      const checkoutResponse = await this.paymentService.createCheckout({
        variantId: subscriptionPlan.external_payment_gateway_variant_id,
        email: createSubscriptionDto.metadata?.email,
        customData: {
          userId: request?.userContext?.userId,
          planId: subscriptionPlan.id,
          email: createSubscriptionDto.metadata?.email
        }
      });
      
      return checkoutResponse;
    } catch (error) {
      this.logger.error('createCheckoutSession -> Checkout creation error:', {
        error,
        request
      });
      throw new BadRequestException(
      error?.message || MESSAGES.FAILED_TO_CREATE_CHECKOUT_SESSION,
        ERROR_CODES.CHECKOUT_SESSION_CREATION_FAILED
      );
    }
  }

  @Get('subscriptions/:id')
  @ApiOperation({ summary: 'Get subscription details from database by ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the subscription details from database'
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  @ApiResponse({ status: 400, description: 'Invalid subscription ID' })
  async getSubscriptionById(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: RequestWithUserContext
  ) {
    // Get subscription from database (validation handled by DTO)
    const subscription = await this.subscriptionService.findById(id);

    if (!subscription) {
      throw new NotFoundException(
        'Subscription not found',
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND
      );
    }

    return subscription;
  }

  @Get('user/:userId/subscriptions')
  @ApiOperation({ summary: 'Get all subscriptions for a user from database' })
  @ApiResponse({ status: 200, description: 'Returns user subscriptions from database' })
  @ApiResponse({ status: 400, description: 'Invalid user ID' })
  async getUserSubscriptions(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Req() request: RequestWithUserContext
  ) {
    // Get user subscriptions (validation handled by DTO)
    return await this.subscriptionService.findByUserId(userId);
  }


  // Subscription Plan Endpoints

  @Get('plans')
  @ApiOperation({ summary: 'Get all active subscription plans' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns all active subscription plans',
    type: [SubscriptionPlanResponseDto]
  })
  async getSubscriptionPlans() {
    return await this.subscriptionPlanService.findAll();
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get subscription plan by ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the subscription plan',
    type: SubscriptionPlanResponseDto
  })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  @ApiResponse({ status: 400, description: 'Invalid plan ID' })
  async getSubscriptionPlanById(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Get subscription plan (validation handled by DTO)
    const subscriptionPlan = await this.subscriptionPlanService.findById(id);
    
    if (!subscriptionPlan) {
      throw new NotFoundException(
        'Subscription plan not found',
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND
      );
    }

    return subscriptionPlan;
  }

  //#region Webhook Controllers

  @Public()
  @Post('payment-confirmation')
  @ApiOperation({ summary: 'Handle payment confirmation notification events' })
  @ApiResponse({ status: 200, description: 'Payment Confirmation processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid Payment request' })
  async paymentConfirmation(
    @Headers('x-signature') signature: string,
    @Body() payload: any,
  ) {
    try {
      this.logger.log('🔔 Payment gateway "payment-confirmation" notification endpoint reached successfully!');
      this.logger.log(`🔥 DEBUG: Received "payment-confirmation" notification payload:`, payload);
      
      // Step 1: Create payment history record first (audit trail)
      this.logger.log(`🔥 DEBUG: Creating payment history record...`);
      const paymentHistory = await this.paymentHistoryService.paymentConfirmation(payload);
      this.logger.log(`🔥 DEBUG: Payment history created:`, { id: paymentHistory.id });

      // Step 2: Verify signature
      if (signature && !await this.subscriptionService.verifySignature(signature, JSON.stringify(payload))) {
        await this.paymentHistoryService.markAsFailed(paymentHistory.id, 'Invalid signature');
        throw new BadRequestException('Invalid signature', ERROR_CODES.BAD_REQUEST);
      }

      // Step 3: Process subscription logic (decoupled from payment history)
      this.logger.log(`🔥 DEBUG: Processing subscription logic...`);
      const subscriptionResult = await this.subscriptionService.processPaymentGatewayEvent(payload);
      this.logger.log(`🔥 DEBUG: Subscription processing result:`, subscriptionResult);

      // Step 4: Mark payment as processed
      await this.paymentHistoryService.markAsProcessed(paymentHistory.id);
      
      const result = {
        success: true,
        message: 'Payment gateway notification processed successfully',
        data: {
          paymentHistory: {
            id: paymentHistory.id,
            status: paymentHistory.status,
            paymentType: paymentHistory.payment_type,
            amount: paymentHistory.amount,
            currency: paymentHistory.currency
          },
          ...subscriptionResult
        }
      };

      // Log processing results
      this.logger.log(`🎯 NEW Subscription created in database:`, {
          subscriptionId: result?.data?.subscription?.subscriptionId,
          status: result?.data?.subscription?.status,
          isActive: result?.data?.subscription?.isActive,
          userId: result?.data?.subscription?.userId,
          planId: result?.data?.subscription?.subscriptionPlanId,
          paymentHistoryId: paymentHistory.id
        });
      
      return result;

    } catch (error) {
      this.logger.error('Failed to process payment gateway notification', error);
      throw error;
    }
  }
  //#endregion



}