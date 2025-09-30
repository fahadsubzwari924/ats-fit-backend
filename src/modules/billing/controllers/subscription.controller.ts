import { Controller, Post, Body, Get, UseGuards, Param, Delete, Req, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt.guard';
import { RequestWithUserContext } from '../../../shared/interfaces/request-user.interface';
import { LemonSqueezyService } from '../../../shared/modules/external/services/lemon_squeezy.service';
import { SubscriptionService } from '../../subscription/services/subscription.service';
import { CheckoutResponseDto } from '../../subscription/dtos/checkout-response.dto';
import { CreateSubscriptionDto } from '../../subscription/dtos/subscription.dto';
import { Checkout } from '@lemonsqueezy/lemonsqueezy.js';


@ApiTags('Subscriptions')
@Controller('subscriptions')
// @UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class SubscriptionController {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly lemonSqueezyService: LemonSqueezyService,
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
  ): Promise<Checkout> 
  {
    try {
      const checkoutSessionResponse = await this.lemonSqueezyService.createCheckoutSession(
        request?.userContext?.userId, 
        createSubscriptionDto.planId,
        createSubscriptionDto.metadata?.email
      );

      if (!checkoutSessionResponse) {
        throw new Error('Invalid checkout session response from LemonSqueezy');
      }

      return checkoutSessionResponse;

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

  @Get('subscriptions/lemonsqueezy/:lemonSqueezyId')
  @ApiOperation({ summary: 'Get subscription details from LemonSqueezy API' })
  @ApiResponse({ 
    status: 200, 
    description: 'Returns the subscription details from LemonSqueezy'
  })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async getLemonSqueezySubscription(
    @Param('lemonSqueezyId') lemonSqueezyId: string,
    @Req() request: RequestWithUserContext
  ) {
    try {
      const subscriptionData = await this.lemonSqueezyService.getSubscriptionDetails(lemonSqueezyId);
      return {
        id: lemonSqueezyId,
        status: subscriptionData.status,
        planId: subscriptionData.variant_id,
        fullData: subscriptionData,
        success: true
      };
    } catch (error) {
      throw new BadRequestException(
        error.message || 'Failed to get subscription details from LemonSqueezy'
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

  @Delete('subscriptions/lemonsqueezy/:lemonSqueezyId/cancel')
  @ApiOperation({ summary: 'Cancel a subscription via LemonSqueezy API' })
  @ApiResponse({ status: 200, description: 'Subscription cancelled successfully via LemonSqueezy' })
  @ApiResponse({ status: 404, description: 'Subscription not found' })
  async cancelLemonSqueezySubscription(
    @Param('lemonSqueezyId') lemonSqueezyId: string,
    @Req() request: RequestWithUserContext,
  ) {
    try {
      const cancelResult = await this.lemonSqueezyService.cancelSubscription(lemonSqueezyId);
      
      // Also update in database if exists
      const dbSubscription = await this.subscriptionService.findByLemonSqueezyId(lemonSqueezyId);
      if (dbSubscription) {
        await this.subscriptionService.cancel(dbSubscription.id);
      }
      
      return {
        id: lemonSqueezyId,
        status: 'cancelled',
        message: 'Subscription cancelled successfully',
        success: true,
        data: cancelResult
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
      const portalUrl = await this.lemonSqueezyService.getCustomerPortalUrl(customerId);
      return {
        portalUrl,
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
}