import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSubscription } from '../../../database/entities/user-subscription.entity';
import { SubscriptionStatus } from '../enums/subscription-status.enum';
import { SubscriptionCancellationResponse } from '../models';
import { ICreateSubscriptionData, IUpdateSubscriptionData } from '../interfaces/subscription.interface';
import { BadRequestException, NotFoundException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { PaymentHistoryService } from 'src/modules/subscription/services/payment-history.service';
import { LemonSqueezyEvent } from 'src/shared/modules/external/enums';
import { PaymentConfirmationDto } from '../dtos/payment-confirmation.dto';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepository: Repository<UserSubscription>,
    private readonly paymentHistoryService: PaymentHistoryService,
    private readonly configService: ConfigService,
  ) {}

  async create(data: ICreateSubscriptionData): Promise<UserSubscription> {
    try {
      this.logger.debug('SubscriptionService.create() called with data:', data);
      
      const subscription = this.subscriptionRepository.create({
        external_subscription_id: data.external_subscription_id,
        subscription_plan_id: data.subscription_plan_id,
        user_id: data.user_id,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        starts_at: data.starts_at,
        ends_at: data.ends_at,
        metadata: data.metadata,
        is_active: data.status === SubscriptionStatus.ACTIVE,
        is_cancelled: false,
      });
      
      this.logger.debug('Created subscription entity:', subscription);
      this.logger.debug('About to save to database...');
      
      const savedSubscription = await this.subscriptionRepository.save(subscription);
      
      this.logger.log('Subscription saved to database successfully', { 
        subscriptionId: savedSubscription.id,
        externalSubscriptionId: savedSubscription.external_subscription_id,
        userId: savedSubscription.user_id
      });
      
      return savedSubscription;
    } catch (error) {
      this.logger.error('Failed to create subscription in database', {
        error: error.message,
        stack: error.stack,
        code: error.code,
        detail: error.detail,
        data
      });
      
      throw new BadRequestException(
        `Failed to create subscription: ${error.message}`,
        ERROR_CODES.BAD_REQUEST
      );
    }
  }

  async findById(id: string): Promise<UserSubscription> {
    const subscription = await this.subscriptionRepository.findOne({
      where: { id },
    });

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with ID ${id} not found`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND
      );
    }

    return subscription;
  }

  async findByExternalId(externalId: string): Promise<UserSubscription | null> {
    return await this.subscriptionRepository.findOne({
      where: { external_subscription_id: externalId },
    });
  }

  async createCancellationResponse(
    cancelResult: any, 
    provider: string, 
    message: string
  ): Promise<SubscriptionCancellationResponse> {
    // Create response using the model class
    const response = SubscriptionCancellationResponse.fromResponse(
      cancelResult,
      provider,
      message
    );
    return response;
  }

  async findByUserId(userId: string): Promise<UserSubscription[]> {
    return await this.subscriptionRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  async findActiveByUserId(userId: string): Promise<UserSubscription | null> {
    return await this.subscriptionRepository.findOne({
      where: { 
        user_id: userId, 
        is_active: true,
        is_cancelled: false 
      },
      order: { created_at: 'DESC' },
    });
  }

  async update(id: string, data: IUpdateSubscriptionData): Promise<UserSubscription> {
    // Validate input
    this.validateSubscriptionId(id);
    
    // Verify subscription exists (findById throws NotFoundException if not found)
    await this.findById(id);
    
    // Use TypeORM's update method for partial updates (more efficient and safe)
    const updateResult = await this.subscriptionRepository.update(id, data);
    
    if (updateResult.affected === 0) {
      throw new NotFoundException(
        `Failed to update subscription with ID ${id}`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND
      );
    }

    // Return the updated entity
    return await this.findById(id);
  }

  async updateByExternalId(externalId: string, data: IUpdateSubscriptionData): Promise<UserSubscription> {
    // Validate input
    if (!externalId || externalId?.trim() === '') {
      throw new BadRequestException(
        'External subscription ID is required and must be a valid string',
        ERROR_CODES.BAD_REQUEST
      );
    }

    // Find subscription to verify it exists
    const subscription = await this.findByExternalId(externalId);
    
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with external ID ${externalId} not found`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND
      );
    }
    
    // Use TypeORM's update method for partial updates
    const updateResult = await this.subscriptionRepository.update(
      { external_subscription_id: externalId }, 
      data
    );
    
    if (updateResult.affected === 0) {
      throw new NotFoundException(
        `Failed to update subscription with external ID ${externalId}`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND
      );
    }

    // Return the updated entity
    return await this.findByExternalId(externalId);
  }

  async cancel(id: string): Promise<UserSubscription> {
    return await this.update(id, {
      status: SubscriptionStatus.CANCELLED,
      is_active: false,
      is_cancelled: true,
    });
  }

  async activate(id: string): Promise<UserSubscription> {
    return await this.update(id, {
      status: SubscriptionStatus.ACTIVE,
      is_active: true,
      is_cancelled: false,
    });
  }

  async delete(id: string): Promise<void> {
    // Single Responsibility: Input validation
    this.validateSubscriptionId(id);

    // Single Responsibility: Existence verification (reusing existing method)
    await this.findById(id);

    // Single Responsibility: Perform deletion with proper error handling
    await this.performDeletion(id);
  }

  /**
   * Validates subscription ID input
   * @private
   */
  private validateSubscriptionId(id: string): void {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      throw new BadRequestException(
        'Subscription ID is required and must be a valid string',
        ERROR_CODES.BAD_REQUEST
      );
    }
  }

  /**
   * Performs the actual deletion operation with proper error handling
   * @private
   */
  private async performDeletion(id: string): Promise<void> {
    try {
      const result = await this.subscriptionRepository.delete(id);
      
      if (result?.affected === 0) {
        // This should not happen if findById passed, but defensive programming
        throw new NotFoundException(
          `Subscription with ID ${id} not found`,
          ERROR_CODES.SUBSCRIPTION_NOT_FOUND
        );
      }

      this.logger.log(`Successfully deleted subscription: ${id}`);
    } catch (error) {
      this.logger.error(`Failed to delete subscription ${id}:`, error);
      throw error;
    }
  }

  async countByUserId(userId: string): Promise<number> {
    return await this.subscriptionRepository.count({
      where: { user_id: userId },
    });
  }

  async isUserSubscribed(userId: string): Promise<boolean> {
    const activeSubscription = await this.findActiveByUserId(userId);
    return !!activeSubscription;
  }


  //#region Webhook Functions

  async paymentConfirmation(signature: string, payload: any): Promise<{ success: boolean; message: string; data: any }> {
    try {
      this.logger.log(`Processing webhook: ${payload.meta?.event_name}`);

      // Create payment history record first (for audit trail)
      const paymentHistory = await this.paymentHistoryService.paymentConfirmation(payload);

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
          const subscription = await this.findByExternalId(payload.data?.id);
          if (subscription) {
            subscriptionInfo = {
              subscriptionId: subscription.id,
              status: subscription.status,
              isActive: subscription.is_active,
              userId: subscription.user_id,
              subscriptionPlanId: subscription.subscription_plan_id
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
            paymentType: paymentHistory.payment_type,
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

  private async processSubscription(payload: PaymentConfirmationDto, paymentHistoryId: string): Promise<void> {
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
   * Create subscription from webhook data
   */
  private async createSubscriptionFromWebhook(payload: PaymentConfirmationDto): Promise<void> {
    try {
      this.logger.log(`🔥 DEBUG: Starting subscription creation process...`);
      
      const subscriptionData: ICreateSubscriptionData = {
        external_subscription_id: payload?.data?.id,
        subscription_plan_id: payload?.meta?.custom_data?.plan_id,
        user_id: payload?.meta?.custom_data?.user_id,
        status: this.mapLemonSqueezyStatusToSubscriptionStatus(payload?.data?.attributes?.status),
        amount: payload?.data?.attributes?.total || 0,
        currency: payload?.data?.attributes?.currency || 'USD',
        starts_at: new Date(payload?.data?.attributes?.created_at || Date.now()),
        ends_at: new Date(payload?.data?.attributes?.renews_at || payload?.data?.attributes?.ends_at || Date.now() + 30 * 24 * 60 * 60 * 1000), // Default to 30 days
        metadata: {
          lemonSqueezyData: payload?.data?.attributes,
          customData: payload?.meta?.custom_data
        }
      };

      this.logger.log(`🔥 DEBUG: Subscription data to create:`, subscriptionData);
      this.logger.log(`🔥 DEBUG: Calling subscriptionService.create()...`);
      
      const subscription = await this.create(subscriptionData);
      
      this.logger.log(`✅ SUCCESS: Created subscription in database!`);
      this.logger.log(`✅ SUCCESS: Subscription ID: ${subscription.id}`);
      this.logger.log(`✅ SUCCESS: Subscription status: ${subscription.status}`);
      this.logger.log(`✅ SUCCESS: Subscription isActive: ${subscription.is_active}`);
      
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

  //#endregion

  
}