import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { WebhookEventDto } from '../dtos/webhook.dto';
import { SubscriptionService } from './subscription.service';

@Injectable()
export class WebhookService {
  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly configService: ConfigService,
  ) {}

  async handleWebhook(signature: string, payload: WebhookEventDto) {
    // Verify webhook signature
    this.verifyWebhookSignature(signature, JSON.stringify(payload));

    switch (payload.event_name) {
      case 'subscription_created':
        await this.handleSubscriptionCreated(payload.data);
        break;
      case 'subscription_updated':
        await this.handleSubscriptionUpdated(payload.data);
        break;
      case 'subscription_cancelled':
        await this.handleSubscriptionCancelled(payload.data);
        break;
      case 'subscription_payment_success':
        await this.handleSubscriptionPaymentSuccess(payload.data);
        break;
      case 'subscription_payment_failed':
        await this.handleSubscriptionPaymentFailed(payload.data);
        break;
      default:
        console.log(`Unhandled webhook event: ${payload.event_name}`);
    }
  }

  private verifyWebhookSignature(signature: string, payload: string) {
    const secret = this.configService.get('LEMON_SQUEEZY_WEBHOOK_SECRET');
    const hmac = crypto.createHmac('sha256', secret);
    const expectedSignature = hmac.update(payload).digest('hex');

    if (signature !== expectedSignature) {
      throw new Error('Invalid webhook signature');
    }
  }

  private async handleSubscriptionCreated(data: any) {
    // Create subscription record from webhook data
    try {
    //   await this.subscriptionService.createSubscriptionFromWebhook(data);
      console.log(`Subscription created successfully: ${data.id}`);
    } catch (error) {
      console.error(`Failed to create subscription from webhook: ${error.message}`);
      // Don't throw error to avoid webhook retry loops
    }
  }

  private async handleSubscriptionUpdated(data: any) {
    // await this.subscriptionService.updateSubscriptionStatus(
    //   data.id,
    //   data.attributes.status,
    //   data.attributes.metadata
    // );
  }

  private async handleSubscriptionCancelled(data: any) {
    // await this.subscriptionService.updateSubscriptionStatus(
    //   data.id,
    //   'cancelled',
    //   data.attributes.metadata
    // );
  }

  private async handleSubscriptionPaymentSuccess(data: any) {
    // await this.subscriptionService.updateSubscriptionStatus(
    //   data.id,
    //   'active',
    //   {
    //     ...data.attributes.metadata,
    //     lastPaymentStatus: 'success',
    //     lastPaymentDate: new Date(),
    //   }
    // );
  }

  private async handleSubscriptionPaymentFailed(data: any) {
    // await this.subscriptionService.updateSubscriptionStatus(
    //   data.id,
    //   'payment_failed',
    //   {
    //     ...data.attributes.metadata,
    //     lastPaymentStatus: 'failed',
    //     lastPaymentDate: new Date(),
    //   }
    // );
  }
}