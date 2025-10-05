import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { WebhookEventDto } from '../dtos/webhook.dto';
import { CreateSubscriptionData, SubscriptionService } from '../../subscription/services/subscription.service';
import { PaymentHistoryService } from './payment-history.service';
import { LemonSqueezyEvent } from '../../../shared/modules/external/enums';
import { SubscriptionStatus } from '../../subscription/enums/subscription-status.enum';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly paymentHistoryService: PaymentHistoryService,
    private readonly configService: ConfigService,
  ) {}

  // WebhookEventDto
  async handleWebhook(signature: string, payload: any): Promise<{ success: boolean; message: string; data: any }> {
    try {
      this.logger.log(`Processing webhook: ${payload.meta?.event_name}`);

      // Create payment history record first (for audit trail)
      const paymentHistory = await this.paymentHistoryService.createFromWebhook(payload);

      // Verify webhook signature
      if (signature && !this.verifyWebhookSignature(signature, JSON.stringify(payload))) {
        await this.paymentHistoryService.markAsFailed(paymentHistory.id, 'Invalid webhook signature');
        throw new BadRequestException('Invalid webhook signature');
      }

      // Process the webhook event
      await this.processSubscription(payload, paymentHistory.id);
      

      // Mark event as processed
      await this.paymentHistoryService.markAsProcessed(paymentHistory.id);

      this.logger.log(`Webhook processed successfully: ${paymentHistory.id}`);
      
      // Check if subscription was created/updated for subscription events
      let subscriptionInfo = null;
      const eventType = payload.meta?.event_name;
      if (eventType === LemonSqueezyEvent.SUBSCRIPTION_CREATED || eventType === LemonSqueezyEvent.SUBSCRIPTION_PAYMENT_SUCCESS) {
        try {
          const subscription = await this.subscriptionService.findByLemonSqueezyId(payload.data?.id);
          if (subscription) {
            subscriptionInfo = {
              subscriptionId: subscription.id,
              status: subscription.status,
              isActive: subscription.isActive,
              userId: subscription.userId,
              subscriptionPlanId: subscription.subscriptionPlanId
            };
            this.logger.log(`✅ Subscription entry confirmed in database: ${subscription.id}`);
          }
        } catch (error) {
          this.logger.warn(`Could not verify subscription creation: ${error.message}`);
        }
      }
      
      return {
        success: true,
        message: 'Webhook processed successfully',
        data: {
          paymentHistory: {
            id: paymentHistory.id,
            status: paymentHistory.status,
            paymentType: paymentHistory.paymentType,
            amount: paymentHistory.amount,
            currency: paymentHistory.currency
          },
          eventType: eventType,
          subscriptionCreated: !!subscriptionInfo,
          subscription: subscriptionInfo
        }
      };

    } catch (error) {
      this.logger.error('Failed to process webhook', error);
      throw error;
    }
  }

  private async processSubscription(payload: WebhookEventDto, paymentHistoryId: string): Promise<void> {
    try {
      this.createSubscriptionFromWebhook(payload);
    } catch (error) {
      await this.paymentHistoryService.markAsFailed(paymentHistoryId, error.message);
      throw error;
    }
  }

  private verifyWebhookSignature(signature: string, payload: string): boolean {
    // For development/testing, skip signature verification
    if (process.env.NODE_ENV === 'development' || !signature) {
      return true;
    }

    try {
      const secret = this.configService.get('LEMON_SQUEEZY_WEBHOOK_SECRET');
      if (!secret) {
        this.logger.warn('Webhook secret not configured, skipping verification');
        return true;
      }

      const hmac = crypto.createHmac('sha256', secret);
      const expectedSignature = hmac.update(payload).digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      this.logger.error('Failed to verify webhook signature', error);
      return false;
    }
  }
  
  /**
   * Extract custom data from webhook data
   * Helper method to get custom data sent during checkout
   */
  private extractCustomDataFromWebhook(data: any): Record<string, any> | null {
    try {
      this.logger.log(`🔍 DEBUG: Searching for custom data in webhook...`);
      
      // Try different possible locations for custom data in webhook
      const possibleLocations = [
        { name: 'data.attributes.custom_data', value: data?.attributes?.custom_data },
        { name: 'data.attributes.checkout_data.custom', value: data?.attributes?.checkout_data?.custom },
        { name: 'data.attributes.checkout_data.custom_data', value: data?.attributes?.checkout_data?.custom_data },
        { name: 'data.custom_data', value: data?.custom_data },
        { name: 'data.attributes.first_order_item.custom_data', value: data?.attributes?.first_order_item?.custom_data },
        { name: 'data.attributes.order.custom_data', value: data?.attributes?.order?.custom_data },
      ];

      this.logger.log(`🔍 DEBUG: Checking ${possibleLocations.length} possible locations for custom data...`);

      for (const location of possibleLocations) {
        this.logger.log(`🔍 DEBUG: Checking ${location.name}:`, location.value);
        
        if (location.value && typeof location.value === 'object' && Object.keys(location.value).length > 0) {
          this.logger.log(`✅ Found custom data in ${location.name}:`, location.value);
          return location.value;
        }
      }

      this.logger.warn(`⚠️ No custom data found in any location`);
      this.logger.log(`🔍 DEBUG: Full data structure for analysis:`, JSON.stringify(data, null, 2));
      
      return null;
    } catch (error) {
      this.logger.error('❌ Error extracting custom data from webhook data:', error);
      return null;
    }
  }

  /**
   * Create subscription from webhook data
   */
  private async createSubscriptionFromWebhook(payload: WebhookEventDto): Promise<void> {
    try {
      this.logger.log(`🔥 DEBUG: Starting subscription creation process...`);
      
      const subscriptionData: CreateSubscriptionData = {
        lemonSqueezyId: payload?.data?.id,
        subscriptionPlanId: payload?.meta?.custom_data?.plan_id,
        userId: payload?.meta?.custom_data?.user_id,
        status: this.mapLemonSqueezyStatusToSubscriptionStatus(payload?.data?.attributes?.status),
        amount: payload?.data?.attributes?.total || 0,
        currency: payload?.data?.attributes?.currency || 'USD',
        startsAt: new Date(payload?.data?.attributes?.created_at || Date.now()),
        endsAt: new Date(payload?.data?.attributes?.renews_at || payload?.data?.attributes?.ends_at || Date.now() + 30 * 24 * 60 * 60 * 1000), // Default to 30 days
        metadata: {
          lemonSqueezyData: payload?.data?.attributes,
          customData: payload?.meta?.custom_data
        }
      };

      this.logger.log(`🔥 DEBUG: Subscription data to create:`, subscriptionData);
      this.logger.log(`🔥 DEBUG: Calling subscriptionService.create()...`);
      
      const subscription = await this.subscriptionService.create(subscriptionData);
      
      this.logger.log(`✅ SUCCESS: Created subscription in database!`);
      this.logger.log(`✅ SUCCESS: Subscription ID: ${subscription.id}`);
      this.logger.log(`✅ SUCCESS: Subscription status: ${subscription.status}`);
      this.logger.log(`✅ SUCCESS: Subscription isActive: ${subscription.isActive}`);
      
    } catch (error) {
      this.logger.error(`❌ CRITICAL ERROR: Failed to create subscription from webhook:`, error);
      this.logger.error(`❌ Error message: ${error.message}`);
      this.logger.error(`❌ Error stack: ${error.stack}`);
      
      if (error.code) {
        this.logger.error(`❌ Database error code: ${error.code}`);
      }
      
      throw error;
    }
  }

  /**
   * Map LemonSqueezy status to our SubscriptionStatus enum
   */
  private mapLemonSqueezyStatusToSubscriptionStatus(status: string): SubscriptionStatus {
    const statusMap: Record<string, SubscriptionStatus> = {
      'active': SubscriptionStatus.ACTIVE,
      'cancelled': SubscriptionStatus.CANCELLED, 
      'expired': SubscriptionStatus.EXPIRED,
      'paused': SubscriptionStatus.PAUSED,
      'past_due': SubscriptionStatus.PAST_DUE,
      'on_trial': SubscriptionStatus.ACTIVE,
      'unpaid': SubscriptionStatus.PAST_DUE
    };

    return statusMap[status?.toLowerCase()] || SubscriptionStatus.ACTIVE;
  }

}