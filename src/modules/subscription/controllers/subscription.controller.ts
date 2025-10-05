import { Controller, Post, Body, Get, UseGuards, Param, Delete, Req, BadRequestException, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionPlanService } from '../services/subscription-plan.service';
import { PaymentService } from '../../../shared/services/payment.service';
import { CreateSubscriptionDto, UpdateSubscriptionDto } from '../dtos/subscription.dto';
import { CreateSubscriptionPlanDto, UpdateSubscriptionPlanDto, SubscriptionPlanResponseDto } from '../dtos/subscription-plan.dto';
import { CheckoutResponseDto, SubscriptionStatusDto } from '../dtos/checkout-response.dto';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';

@ApiTags('Subscriptions')
@Controller('subscriptions')
// @UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly subscriptionPlanService: SubscriptionPlanService,
    private readonly paymentService: PaymentService, // ✅ Abstract payment interface
  ) {}

  @Post('checkout')
  @ApiOperation({ summary: 'Create a checkout session for subscription' })
  @ApiResponse({ 
    status: 201, 
    description: 'Checkout session created successfully',
    type: CheckoutResponseDto
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async createCheckoutSession(
    @Body() createSubscriptionDto: CreateSubscriptionDto,
    @Req() request: RequestWithUserContext,
  ) {
    try {
      // Find the subscription plan by planId from the database
      const subscriptionPlan = await this.subscriptionPlanService.findById(createSubscriptionDto.planId);
      
      if (!subscriptionPlan) {
        throw new BadRequestException(`Subscription plan with ID ${createSubscriptionDto.planId} not found`);
      }

      if (!subscriptionPlan.isActive) {
        throw new BadRequestException(`Subscription plan with ID ${createSubscriptionDto.planId} is not active`);
      }

      const checkoutResponse = await this.paymentService.createCheckout({
        variantId: subscriptionPlan.lemonSqueezyVariantId,
        email: createSubscriptionDto.metaData?.email,
        customData: {
          userId: request?.userContext?.userId,
          planId: subscriptionPlan.id,
          email: createSubscriptionDto.metaData?.email
        }
      });
      
      return checkoutResponse;
    } catch (error) {
      console.error('Checkout creation error:', error);
      throw new BadRequestException(
        error.message || 'Failed to create checkout session'
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
  async getSubscription(
    @Param('id') subscriptionId: string,
    @Req() request: RequestWithUserContext
  ) {
    // Get subscription from database
    return await this.subscriptionService.findById(subscriptionId);
  }

  @Get('subscriptions/external/:subscriptionId')
  @ApiOperation({ summary: 'Get subscription details from payment provider API' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the subscription details from payment provider'
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async getExternalSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Req() request: RequestWithUserContext
  ) {
    try {
      const subscriptionData = await this.paymentService.getSubscription(subscriptionId);
      return {
        id: subscriptionData.id,
        status: subscriptionData.status,
        planId: subscriptionData.planId,
        provider: this.paymentService.getProviderName(),
        amount: subscriptionData.amount,
        currency: subscriptionData.currency,
        currentPeriodEnd: subscriptionData.currentPeriodEnd,
        success: true
      };
    } catch (error) {
      throw new BadRequestException(
        error.message || `Failed to get subscription details from ${this.paymentService.getProviderName()}`
      );
    }
  }

  @Delete('subscriptions/:id/cancel')
  @ApiOperation({ summary: 'Cancel a subscription in database' })
  @ApiResponse({ status: 200, description: 'Subscription cancelled successfully in database' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async cancelSubscriptionInDatabase(
    @Param('id') subscriptionId: string,
    @Req() request: RequestWithUserContext,
  ) {
    // Cancel subscription in database only
    return await this.subscriptionService.cancel(subscriptionId);
  }

  @Delete('subscriptions/cancel/:subscriptionId')
  @ApiOperation({ summary: 'Cancel a subscription via payment provider API' })
  @ApiResponse({ status: 200, description: 'Subscription cancelled successfully via payment provider' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async cancelExternalSubscription(
    @Param('subscriptionId') subscriptionId: string,
    @Req() request: RequestWithUserContext,
  ) {
    try {
      const cancelResult = await this.paymentService.cancelSubscription({
        subscriptionId,
        reason: 'User requested cancellation'
      });

      // Also update in database if exists
      const dbSubscription = await this.subscriptionService.findByLemonSqueezyId(subscriptionId);
      if (dbSubscription) {
        await this.subscriptionService.cancel(dbSubscription.id);
      }
      
      return {
        id: cancelResult.subscriptionId,
        status: cancelResult.status,
        provider: this.paymentService.getProviderName(),
        cancelledAt: cancelResult.cancelledAt,
        endsAt: cancelResult.endsAt,
        message: 'Subscription cancelled successfully',
        success: true
      };
    } catch (error) {
      throw new BadRequestException(
        error.message || 'Failed to cancel subscription'
      );
    }
  }

  @Get('customer/:customerId/portal')
  @ApiOperation({ summary: 'Get customer portal URL for managing subscription' })
  @ApiResponse({ status: 200, description: 'Returns the customer portal URL' })
  async getCustomerPortal(
    @Param('customerId') customerId: string,
    @Req() request: RequestWithUserContext
  ) {
    try {
      const portalResponse = await this.paymentService.createCustomerPortal({
        customerId,
        returnUrl: request.headers['referer'] || undefined
      });
      
      return {
        portalUrl: portalResponse.portalUrl,
        provider: this.paymentService.getProviderName(),
        expiresAt: portalResponse.expiresAt,
        message: 'Redirect user to portalUrl to manage subscription',
        success: true
      };
    } catch (error) {
      throw new BadRequestException(
        error.message || 'Failed to get customer portal URL'
      );
    }
  }

  @Get('user/:userId/subscriptions')
  @ApiOperation({ summary: 'Get all subscriptions for a user from database' })
  @ApiResponse({ status: 200, description: 'Returns user subscriptions from database' })
  async getUserSubscriptions(
    @Param('userId') userId: string,
    @Req() request: RequestWithUserContext
  ) {
    return await this.subscriptionService.findByUserId(userId);
  }

  @Get('user/:userId/active-subscription')
  @ApiOperation({ summary: 'Get active subscription for a user from database' })
  @ApiResponse({ status: 200, description: 'Returns active subscription from database' })
  async getUserActiveSubscription(
    @Param('userId') userId: string,
    @Req() request: RequestWithUserContext
  ) {
    return await this.subscriptionService.findActiveByUserId(userId);
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

  @Get('plans/all')
  @ApiOperation({ summary: 'Get all subscription plans including inactive ones' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns all subscription plans including inactive ones',
    type: [SubscriptionPlanResponseDto]
  })
  async getAllSubscriptionPlans() {
    return await this.subscriptionPlanService.findAllIncludeInactive();
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get subscription plan by ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the subscription plan',
    type: SubscriptionPlanResponseDto
  })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  async getSubscriptionPlan(
    @Param('id') planId: string
  ) {
    return await this.subscriptionPlanService.findById(planId);
  }

  @Get('plans/variant/:variantId')
  @ApiOperation({ summary: 'Get subscription plan by LemonSqueezy variant ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the subscription plan',
    type: SubscriptionPlanResponseDto
  })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  async getSubscriptionPlanByVariant(
    @Param('variantId') variantId: string
  ) {
    const plan = await this.subscriptionPlanService.findByLemonSqueezyVariantId(variantId);
    if (!plan) {
      throw new BadRequestException(`Subscription plan with variant ID ${variantId} not found`);
    }
    return plan;
  }

  @Get('plans/billing/:billingCycle')
  @ApiOperation({ summary: 'Get subscription plans by billing cycle' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns subscription plans for the specified billing cycle',
    type: [SubscriptionPlanResponseDto]
  })
  async getSubscriptionPlansByBilling(
    @Param('billingCycle') billingCycle: string
  ) {
    return await this.subscriptionPlanService.findByBillingCycle(billingCycle);
  }

  @Post('plans')
  @ApiOperation({ summary: 'Create a new subscription plan' })
  @ApiResponse({ 
    status: 201, 
    description: 'Subscription plan created successfully',
    type: SubscriptionPlanResponseDto
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async createSubscriptionPlan(
    @Body() createPlanDto: CreateSubscriptionPlanDto
  ) {
    return await this.subscriptionPlanService.create(createPlanDto);
  }

  @Put('plans/:id')
  @ApiOperation({ summary: 'Update a subscription plan' })
  @ApiResponse({ 
    status: 200, 
    description: 'Subscription plan updated successfully',
    type: SubscriptionPlanResponseDto
  })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  async updateSubscriptionPlan(
    @Param('id') planId: string,
    @Body() updatePlanDto: UpdateSubscriptionPlanDto
  ) {
    return await this.subscriptionPlanService.update(planId, updatePlanDto);
  }

  @Put('plans/:id/activate')
  @ApiOperation({ summary: 'Activate a subscription plan' })
  @ApiResponse({ 
    status: 200, 
    description: 'Subscription plan activated successfully',
    type: SubscriptionPlanResponseDto
  })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  async activateSubscriptionPlan(
    @Param('id') planId: string
  ) {
    return await this.subscriptionPlanService.activate(planId);
  }

  @Put('plans/:id/deactivate')
  @ApiOperation({ summary: 'Deactivate a subscription plan' })
  @ApiResponse({ 
    status: 200, 
    description: 'Subscription plan deactivated successfully',
    type: SubscriptionPlanResponseDto
  })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  async deactivateSubscriptionPlan(
    @Param('id') planId: string
  ) {
    return await this.subscriptionPlanService.deactivate(planId);
  }

  @Delete('plans/:id')
  @ApiOperation({ summary: 'Delete a subscription plan' })
  @ApiResponse({ status: 200, description: 'Subscription plan deleted successfully' })
  @ApiResponse({ status: 404, description: 'Subscription plan not found' })
  async deleteSubscriptionPlan(
    @Param('id') planId: string
  ) {
    await this.subscriptionPlanService.delete(planId);
    return { message: 'Subscription plan deleted successfully', success: true };
  }
}