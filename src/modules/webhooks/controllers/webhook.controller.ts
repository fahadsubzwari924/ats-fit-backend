import { Controller, Post, Headers, Body, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WebhookService } from '../services/webhook.service';
import { PaymentHistoryService } from '../services/payment-history.service';
import { WebhookEventDto } from '../dtos/webhook.dto';
import { Public } from '../../auth/decorators/public.decorator';
import { LemonSqueezyEvent, LemonSqueezyEventHelper } from '../../../shared/modules/external/enums';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly webhookService: WebhookService,
    private readonly paymentHistoryService: PaymentHistoryService,
  ) {}

  @Public()
  @Post('lemon-squeezy')
  @ApiOperation({ summary: 'Handle LemonSqueezy webhook events' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid webhook payload' })
  async handleWebhook(
    @Headers('x-signature') signature: string,
    @Body() payload: any,
  ) {
    const eventType = payload.meta?.event_name;
    
    this.logger.log('🔔 Webhook endpoint reached successfully!');
    this.logger.log(`Event Type: ${eventType}`);
    this.logger.log(`LemonSqueezy ID: ${payload.data?.id}`);
    
    // Validate if it's a known LemonSqueezy event
    if (!LemonSqueezyEventHelper.isValidEvent(eventType)) {
      this.logger.warn(`⚠️ Unknown LemonSqueezy event type: ${eventType}`);
    }
    
    // Enhanced logging for different event categories
    if (LemonSqueezyEventHelper.isSubscriptionEvent(eventType) || LemonSqueezyEventHelper.isPaymentEvent(eventType)) {
      this.logger.log(`📋 Processing ${LemonSqueezyEventHelper.isSubscriptionEvent(eventType) ? 'subscription' : 'payment'} webhook:`, {
        eventType: eventType,
        subscriptionId: payload.data?.id,
        status: payload.data?.attributes?.status,
        hasCustomData: !!(payload.data?.attributes?.custom_data || payload.data?.attributes?.checkout_data?.custom),
        isSubscriptionEvent: LemonSqueezyEventHelper.isSubscriptionEvent(eventType),
        isPaymentEvent: LemonSqueezyEventHelper.isPaymentEvent(eventType),
        shouldCreateSubscription: LemonSqueezyEventHelper.shouldCreateOrUpdateSubscription(eventType),
        shouldDeactivateSubscription: LemonSqueezyEventHelper.shouldDeactivateSubscription(eventType)
      });
    }
    
    // Process webhook through the service layer (handles both payment history and subscription creation)
    this.logger.log(`🔥 DEBUG: About to call webhookService.handleWebhook...`);
    const result = await this.webhookService.handleWebhook(signature, payload);
    this.logger.log(`🔥 DEBUG: Webhook service returned:`, result);
    
    // Log success for different event types with subscription creation confirmation
    if (LemonSqueezyEventHelper.isSubscriptionEvent(eventType)) {
      this.logger.log(`✅ Subscription webhook processed successfully for: ${payload.data?.id}`);
      
      // Log additional info for subscription creation/payment events
      if (LemonSqueezyEventHelper.shouldCreateOrUpdateSubscription(eventType)) {
        this.logger.log(`📋 Subscription entry created/updated in database for event: ${eventType}`);
        
        // Log detailed subscription processing results
        if (result?.data?.subscriptionCreated) {
          this.logger.log(`🎯 NEW Subscription created in database:`, {
            subscriptionId: result.data.subscription?.subscriptionId,
            status: result.data.subscription?.status,
            isActive: result.data.subscription?.isActive,
            userId: result.data.subscription?.userId,
            planId: result.data.subscription?.subscriptionPlanId,
            eventType: eventType
          });
        } else if (result?.data?.subscription) {
          this.logger.log(`🔄 Existing subscription updated:`, {
            subscriptionId: result.data.subscription?.subscriptionId,
            status: result.data.subscription?.status,
            isActive: result.data.subscription?.isActive,
            eventType: eventType
          });
        }
      }
    } else if (LemonSqueezyEventHelper.isPaymentEvent(eventType)) {
      this.logger.log(`✅ Payment webhook processed successfully for: ${payload.data?.id}`);
      
      // Special handling for payment success events that create subscriptions
      if (eventType === LemonSqueezyEvent.SUBSCRIPTION_PAYMENT_SUCCESS) {
        this.logger.log(`💰 Payment success processed - Subscription database entry handled`);
        
        if (result?.data?.subscriptionCreated) {
          this.logger.log(`🎯 Payment SUCCESS created NEW subscription:`, {
            subscriptionId: result.data.subscription?.subscriptionId,
            status: result.data.subscription?.status,
            userId: result.data.subscription?.userId,
            planId: result.data.subscription?.subscriptionPlanId
          });
        } else if (result?.data?.subscription) {
          this.logger.log(`🔄 Payment SUCCESS updated existing subscription:`, {
            subscriptionId: result.data.subscription?.subscriptionId,
            status: result.data.subscription?.status,
            isActive: result.data.subscription?.isActive
          });
        }
      }
    } else if (LemonSqueezyEventHelper.isOrderEvent(eventType)) {
      this.logger.log(`✅ Order webhook processed successfully for: ${payload.data?.id}`);
    } else if (LemonSqueezyEventHelper.isLicenseEvent(eventType)) {
      this.logger.log(`✅ License webhook processed successfully for: ${payload.data?.id}`);
    } else {
      this.logger.log(`✅ Webhook processed successfully for: ${eventType}`);
    }
    
    return result;
  }

  @Public()
  @Post('lemon-squeezy/test')
  @ApiOperation({ summary: 'Test webhook endpoint - saves only payment history' })
  @ApiResponse({ status: 200, description: 'Test webhook processed successfully' })
  async handleTestWebhook(@Body() payload: WebhookEventDto) {
    const eventType = payload.meta?.event_name;
    
    this.logger.log('🧪 Test webhook endpoint reached!');
    this.logger.log(`Test Event Type: ${eventType}`);
    
    // Validate event type
    if (!LemonSqueezyEventHelper.isValidEvent(eventType)) {
      this.logger.warn(`⚠️ Unknown LemonSqueezy event type in test: ${eventType}`);
    }
    
    // Create payment history and process subscription logic for testing
    const paymentHistory = await this.paymentHistoryService.createFromWebhook(payload);
    
    let subscriptionCreated = false;
    
    // Test subscription creation for events that should create/update subscriptions
    if (LemonSqueezyEventHelper.shouldCreateOrUpdateSubscription(eventType) || 
        LemonSqueezyEventHelper.isSubscriptionEvent(eventType)) {
      try {
        // Process through webhook service to test subscription creation
        await this.webhookService.handleWebhook('', payload);
        subscriptionCreated = true;
        this.logger.log('✅ Test subscription processing completed');
      } catch (error) {
        this.logger.warn(`⚠️ Test subscription processing failed: ${error.message}`);
      }
    }
    
    return {
      success: true,
      message: 'Test webhook processed successfully',
      paymentHistoryId: paymentHistory.id,
      paymentType: paymentHistory.paymentType,
      status: paymentHistory.status,
      subscriptionProcessed: subscriptionCreated,
      eventType: eventType,
      eventCategory: {
        isSubscription: LemonSqueezyEventHelper.isSubscriptionEvent(eventType),
        isPayment: LemonSqueezyEventHelper.isPaymentEvent(eventType),
        isOrder: LemonSqueezyEventHelper.isOrderEvent(eventType),
        isLicense: LemonSqueezyEventHelper.isLicenseEvent(eventType),
        shouldCreateSubscription: LemonSqueezyEventHelper.shouldCreateOrUpdateSubscription(eventType),
        shouldDeactivateSubscription: LemonSqueezyEventHelper.shouldDeactivateSubscription(eventType)
      }
    };
  }
}