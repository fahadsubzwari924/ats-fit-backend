import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSubscription } from '../../../database/entities/user-subscription.entity';
import { SubscriptionStatus } from '../enums/subscription-status.enum';
import { SubscriptionCancellationResponse } from '../models';
import {
  ICreateSubscriptionData,
  IUpdateSubscriptionData,
} from '../interfaces/subscription.interface';
import {
  BadRequestException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { PaymentConfirmationDto } from '../dtos/payment-confirmation.dto';
import { CreateSubscriptionFromPaymentGatewayDto } from '../dtos/create-subscription-from-payment-gateway.dto';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { EMAIL_SERVICE_TOKEN, IEmailService } from '../../../shared/interfaces/email.interface';
import { SubscriptionPlan, User } from '../../../database/entities';
import { EmailTemplates, EmailSubjects } from '../../../shared/enums';
import { IAwsEmailConfig, IRecipients } from '../../../shared/interfaces';


@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(UserSubscription)
    private readonly subscriptionRepository: Repository<UserSubscription>,
    private readonly configService: ConfigService,
    @Inject(EMAIL_SERVICE_TOKEN) private readonly emailService: IEmailService
  ) {}

  async create(data: ICreateSubscriptionData): Promise<UserSubscription> {
    try {
      this.logger.debug('SubscriptionService.create() called with data:', data);

      const subscription = this.subscriptionRepository.create({
        payment_gateway_subscription_id:
          data.payment_gateway_subscription_id,
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

      const savedSubscription =
        await this.subscriptionRepository.save(subscription);

      this.logger.log('Subscription saved to database successfully', {
        subscriptionId: savedSubscription.id,
        externalSubscriptionId:
          savedSubscription.payment_gateway_subscription_id,
        userId: savedSubscription.user_id,
      });

      return savedSubscription;
    } catch (error) {
      this.logger.error('Failed to create subscription in database', {
        error: error.message,
        stack: error.stack,
        code: error.code,
        detail: error.detail,
        data,
      });

      throw new BadRequestException(
        `Failed to create subscription: ${error.message}`,
        ERROR_CODES.BAD_REQUEST,
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
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      );
    }

    return subscription;
  }

  async findByExternalId(externalId: string): Promise<UserSubscription | null> {
    return await this.subscriptionRepository.findOne({
      where: { payment_gateway_subscription_id: externalId },
    });
  }

  async createCancellationResponse(
    cancelResult: any,
    provider: string,
    message: string,
  ): Promise<SubscriptionCancellationResponse> {
    // Create response using the model class
    const response = SubscriptionCancellationResponse.fromResponse(
      cancelResult,
      provider,
      message,
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
        is_cancelled: false,
      },
      order: { created_at: 'DESC' },
    });
  }

  async update(
    id: string,
    data: IUpdateSubscriptionData,
  ): Promise<UserSubscription> {
    // Validate input
    this.validateSubscriptionId(id);

    // Verify subscription exists (findById throws NotFoundException if not found)
    await this.findById(id);

    // Use TypeORM's update method for partial updates (more efficient and safe)
    const updateResult = await this.subscriptionRepository.update(id, data);

    if (updateResult.affected === 0) {
      throw new NotFoundException(
        `Failed to update subscription with ID ${id}`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      );
    }

    // Return the updated entity
    return await this.findById(id);
  }

  async updateByExternalId(
    externalId: string,
    data: IUpdateSubscriptionData,
  ): Promise<UserSubscription> {
    // Validate input
    if (!externalId || externalId?.trim() === '') {
      throw new BadRequestException(
        'External subscription ID is required and must be a valid string',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Find subscription to verify it exists
    const subscription = await this.findByExternalId(externalId);

    if (!subscription) {
      throw new NotFoundException(
        `Subscription with external ID ${externalId} not found`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      );
    }

    // Use TypeORM's update method for partial updates
    const updateResult = await this.subscriptionRepository.update(
      { payment_gateway_subscription_id: externalId },
      data,
    );

    if (updateResult.affected === 0) {
      throw new NotFoundException(
        `Failed to update subscription with external ID ${externalId}`,
        ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
      );
    }

    // Return the updated entity
    return await this.findByExternalId(externalId);
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
        ERROR_CODES.BAD_REQUEST,
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
          ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
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

  async handleSuccessfulPayment(payload: any) {
    return this.processPaymentGatewayEvent(payload);
  }

  async handleFailedPayment(payload: any, user: User, plan: SubscriptionPlan) {

    try {
      await this.emailService.sendEmail(
        this.createAWSEmailConfig(),
        { emailsTo: [user?.email] },
        { 
          fromAddress: this.configService.get<string>('AWS_SES_FROM_EMAIL') || 'info@atsfitt.com',
          senderName: this.configService.get<string>('AWS_SES_FROM_NAME') || 'ATS Fit'
        },
        {
          templateKey: EmailTemplates.PAYMENT_FAILED,
          templateData: {
            amount: payload?.data?.attributes?.total_formatted,
            userName: user.full_name,
            planName: plan?.plan_name,
            attemptDate: payload?.data?.attributes?.created_at
          },
          subject: EmailSubjects.PAYMENT_FAILED,
        }
      );

      this.logger.log('Payment failed email sent successfully', {
        data: user,
        timestamp: Date.now(),
      });
    } catch (error) {
      this.logger.error('Failed to send payment failed email', {
        error,
        data: user,
        timestamp: Date.now(),
      });
    }

  
  }

  //#region Payment Gateway Event Processing (Decoupled)

  private createAWSEmailConfig(): IAwsEmailConfig {
    const region = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    const accessKeyId = this.configService.get<string>('AWS_SES_USER_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SES_USER_SECRET_ACCESS_KEY');
    
    return {
      region,
      accessKeyId,
      secretAccessKey
    }
  }

  private createRecipients(emails: string[], emailsCc?: string[], emailsBcc?: string[]): IRecipients {
    return {
      emailsTo: emails,
      emailsCc: emailsCc,
      emailsBcc: emailsBcc,
    };
  }

  /**
   * Verify payment gateway signature
   */
  async verifySignature(signature: string, payload: string): Promise<boolean> {
    // For development/testing, skip signature verification
    if (process.env.NODE_ENV === 'development' || !signature) {
      return true;
    }

    try {
      const secret = this.configService.get('LEMON_SQUEEZY_WEBHOOK_SECRET');
      if (!secret) {
        this.logger.warn(
          'Payment gateway secret not configured, skipping verification',
        );
        return true;
      }

      const hmac = crypto.createHmac('sha256', secret);
      const expectedSignature = hmac.update(payload).digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch (error) {
      this.logger.error('Failed to verify payment gateway signature', error);
      return false;
    }
  }

  /**
   * Process payment gateway events (subscription-focused)
   */
  async processPaymentGatewayEvent(payload: any): Promise<any> {
    try {
      this.logger.log(
        `Processing payment gateway event: ${payload?.meta?.event_name}`,
      );

      // Verify subscription was created

      const eventType = payload?.meta?.event_name;
      let subscriptionInfo = null;

      const subscription = await this.createSubscriptionFromPaymentGatewayEvent(payload);

      if (!subscription) {
        this.logger.warn(
          `Subscription creation failed or returned null for event: ${eventType}`,
        );
        return null;
      }

      subscriptionInfo = {
        subscriptionId: subscription?.id,
        status: subscription?.status,
        isActive: subscription?.is_active,
        userId: subscription?.user_id,
        subscriptionPlanId: subscription?.subscription_plan_id,
      };
      this.logger.log(
        `✅ Subscription entry confirmed in database: ${subscription?.id}`,
      );

      return {
        eventType: eventType,
        subscriptionCreated: !!subscriptionInfo,
        subscription: subscriptionInfo,
      };
    } catch (error) {
      this.logger.error('Failed to process payment gateway event', error);
      throw error;
    }
  }

  /**
   * Create subscription from payment gateway event data
   */
  private async createSubscriptionFromPaymentGatewayEvent(
    payload: PaymentConfirmationDto,
  ): Promise<UserSubscription> {
    try {
      this.logger.log(`🔥 DEBUG: Starting subscription creation process...`);

      // Transform payment gateway payload to subscription data using DTO
      const subscriptionData = new CreateSubscriptionFromPaymentGatewayDto(payload);

      this.logger.log(
        `🔥 DEBUG: Subscription data to create:`,
        subscriptionData,
      );
      this.logger.log(`🔥 DEBUG: Calling subscriptionService.create()...`);

      const subscription = await this.create(subscriptionData);

      this.logger.log(`✅ SUCCESS: Created subscription in database!`);
      this.logger.log(`✅ SUCCESS: Subscription ID: ${subscription?.id}`);
      this.logger.log(
        `✅ SUCCESS: Subscription status: ${subscription?.status}`,
      );
      this.logger.log(
        `✅ SUCCESS: Subscription isActive: ${subscription?.is_active}`,
      );

      return subscription;
    } catch (error) {
      this.logger.error(
        `❌ CRITICAL ERROR: Failed to create subscription from payment gateway event:`,
        error,
      );
      this.logger.error(`❌ Error message: ${error.message}`);
      this.logger.error(`❌ Error stack: ${error.stack}`);

      if (error.code) {
        this.logger.error(`❌ Database error code: ${error.code}`);
      }

      throw error;
    }
  }

  //#endregion
}
