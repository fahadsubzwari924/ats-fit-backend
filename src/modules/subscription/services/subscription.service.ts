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
  ForbiddenException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { PaymentConfirmationDto } from '../dtos/payment-confirmation.dto';
import { CreateSubscriptionFromPaymentGatewayDto } from '../dtos/create-subscription-from-payment-gateway.dto';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  EMAIL_SERVICE_TOKEN,
  IEmailService,
} from '../../../shared/interfaces/email.interface';
import { SubscriptionPlan, User } from '../../../database/entities';
import {
  EmailTemplates,
  EmailSubjects,
  AwsConfigKeys,
} from '../../../shared/enums';
import { IAwsEmailConfig, IRecipients } from '../../../shared/interfaces';
import { UserService } from '../../user/user.service';
import { ExternalPaymentGatewayEvents } from '../externals/enums/external-payment-gateway-events.enum';
import { PaymentService } from '../../../shared/services/payment.service';
import { MESSAGES } from '../../../shared/constants/messages';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(UserSubscription)
    private readonly userSubscriptionRepository: Repository<UserSubscription>,
    private readonly configService: ConfigService,
    @Inject(EMAIL_SERVICE_TOKEN) private readonly emailService: IEmailService,
    private readonly userService: UserService,
    private readonly paymentService: PaymentService,
  ) {}

  async create(data: ICreateSubscriptionData): Promise<UserSubscription> {
    try {
      this.logger.debug('SubscriptionService.create() called with data:', data);

      const subscription = this.userSubscriptionRepository.create({
        payment_gateway_subscription_id: data.payment_gateway_subscription_id,
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
        await this.userSubscriptionRepository.save(subscription);

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
    const subscription = await this.userSubscriptionRepository.findOne({
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
    return await this.userSubscriptionRepository.findOne({
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
    return await this.userSubscriptionRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
    });
  }

  async findActiveByUserId(userId: string): Promise<UserSubscription | null> {
    return await this.userSubscriptionRepository.findOne({
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
    const updateResult = await this.userSubscriptionRepository.update(id, data);

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
    const updateResult = await this.userSubscriptionRepository.update(
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
      const result = await this.userSubscriptionRepository.delete(id);

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
    return await this.userSubscriptionRepository.count({
      where: { user_id: userId },
    });
  }

  async isUserSubscribed(userId: string): Promise<boolean> {
    const activeSubscription = await this.findActiveByUserId(userId);
    return !!activeSubscription;
  }

  async handleSuccessfulPayment(
    payload: PaymentConfirmationDto,
    user: User,
    plan: SubscriptionPlan,
  ): Promise<any> {
    const result = await this.processPaymentGatewayEvent(payload, user, plan);
    if (result?.subscriptionCreated) {
      await this.userService.upgradeToPremium(user.id);
      this.logger.log(
        `User ${user.id} upgraded to premium after successful payment`,
      );
    }
    return result;
  }

  async handleFailedPayment(payload: any, user: User, plan: SubscriptionPlan) {
    try {
      await this.emailService.sendEmail(
        this.createAWSEmailConfig(),
        { emailsTo: [user?.email] },
        {
          fromAddress:
            this.configService.get<string>(AwsConfigKeys.AWS_SES_FROM_EMAIL) ||
            'info@atsfitt.com',
          senderName:
            this.configService.get<string>(AwsConfigKeys.AWS_SES_FROM_NAME) ||
            'ATS Fit',
        },
        {
          templateKey: EmailTemplates.PAYMENT_FAILED,
          templateData: {
            amount: payload?.data?.attributes?.total_formatted,
            userName: user.full_name,
            planName: plan?.plan_name,
            attemptDate: payload?.data?.attributes?.created_at,
          },
          subject: EmailSubjects.PAYMENT_FAILED,
        },
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

  async handleSubscriptionDeactivated(
    payload: PaymentConfirmationDto,
    user: User,
  ): Promise<void> {
    try {
      const externalSubId =
        payload?.data?.attributes?.subscription_id?.toString() ||
        payload?.data?.id;

      if (!externalSubId) {
        this.logger.warn(
          `Cannot process ${payload?.meta?.event_name}: no subscription external ID found in payload`,
        );
        return;
      }

      const eventName = payload?.meta?.event_name;
      const isCancelled =
        eventName === ExternalPaymentGatewayEvents.SUBSCRIPTION_CANCELLED;

      const updateData: IUpdateSubscriptionData = {
        status: isCancelled
          ? SubscriptionStatus.CANCELLED
          : SubscriptionStatus.EXPIRED,
        is_active: false,
        is_cancelled: isCancelled,
        ...(isCancelled ? { cancelled_at: new Date() } : {}),
      };

      await this.updateByExternalId(externalSubId, updateData);
      await this.userService.downgradeToFreemium(user.id);

      this.logger.log(
        `Subscription ${externalSubId} deactivated (${eventName}) for user ${user.id}`,
      );
    } catch (error) {
      this.logger.error('Failed to handle subscription deactivation', error);
      throw error;
    }
  }

  async handleSubscriptionUpdated(
    payload: PaymentConfirmationDto,
  ): Promise<void> {
    try {
      const externalSubId =
        payload?.data?.attributes?.subscription_id?.toString() ||
        payload?.data?.id;

      if (!externalSubId) {
        this.logger.warn(
          `Cannot process ${payload?.meta?.event_name}: no subscription external ID found in payload`,
        );
        return;
      }

      const newStatus = new CreateSubscriptionFromPaymentGatewayDto(payload)
        .status;

      await this.updateByExternalId(externalSubId, {
        status: newStatus,
        is_active: newStatus === SubscriptionStatus.ACTIVE,
        metadata: payload?.data?.attributes as Record<string, any>,
      });

      this.logger.log(
        `Subscription ${externalSubId} updated to status ${newStatus}`,
      );
    } catch (error) {
      this.logger.error('Failed to handle subscription update', error);
      throw error;
    }
  }

  /**
   * Cancel subscription: calls payment gateway then updates local DB.
   * Called by user-initiated cancel (DELETE /subscriptions/:id/cancel).
   */
  async cancelUserSubscription(
    subscriptionId: string,
    userId: string,
  ): Promise<UserSubscription> {
    const subscription = await this.findById(subscriptionId);

    if (subscription.user_id !== userId) {
      throw new ForbiddenException(
        'You do not own this subscription',
        ERROR_CODES.FORBIDDEN,
      );
    }

    if (!subscription.isActiveSubscription()) {
      throw new BadRequestException(
        MESSAGES.SUBSCRIPTION_NOT_ACTIVE,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Cancel at LemonSqueezy
    // 4xx = subscription doesn't exist at gateway (record locally but log ERROR)
    // Network/5xx = transient — still record locally, ops can reconcile via webhook
    try {
      await this.paymentService.cancelSubscription({
        subscriptionId: subscription.payment_gateway_subscription_id,
      });
      this.logger.log(
        `LemonSqueezy cancellation confirmed for ${subscription.payment_gateway_subscription_id}`,
      );
    } catch (error) {
      this.logger.error(
        `LemonSqueezy cancellation call failed for ${subscription.payment_gateway_subscription_id} — proceeding with local cancellation. Manual reconciliation may be needed.`,
        {
          error: error?.message,
          gatewaySubId: subscription.payment_gateway_subscription_id,
        },
      );
      // Intentionally not re-throwing: local DB update captures user intent.
    }

    const cancelled = await this.update(subscriptionId, {
      status: SubscriptionStatus.CANCELLED,
      is_active: false,
      is_cancelled: true,
      cancelled_at: new Date(),
    });

    await this.userService.downgradeToFreemium(userId);

    return cancelled;
  }

  //#region Payment Gateway Event Processing (Decoupled)

  private createAWSEmailConfig(): IAwsEmailConfig {
    const region =
      this.configService.get<string>(AwsConfigKeys.AWS_REGION) || 'us-east-1';
    const accessKeyId = this.configService.get<string>(
      AwsConfigKeys.AWS_SES_USER_ACCESS_KEY_ID,
    );
    const secretAccessKey = this.configService.get<string>(
      AwsConfigKeys.AWS_SES_USER_SECRET_ACCESS_KEY,
    );

    return {
      region,
      accessKeyId,
      secretAccessKey,
    };
  }

  private createRecipients(
    emails: string[],
    emailsCc?: string[],
    emailsBcc?: string[],
  ): IRecipients {
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
  async processPaymentGatewayEvent(
    payload: PaymentConfirmationDto,
    user?: User,
    plan?: SubscriptionPlan,
  ): Promise<any> {
    try {
      const eventType = payload?.meta?.event_name;
      this.logger.log(`Processing payment gateway event: ${eventType}`);

      // LemonSqueezy sends both subscription_created and subscription_payment_success for new subs.
      // For subscription_created: data.id IS the subscription external ID.
      // For subscription_payment_success: subscription ID is in data.attributes.subscription_id.
      const subscriptionExternalId =
        payload?.data?.attributes?.subscription_id?.toString() ||
        payload?.data?.id;

      // Idempotency: if subscription already exists, update status instead of creating duplicate
      const existing = await this.findByExternalId(subscriptionExternalId);
      if (existing) {
        this.logger.log(
          `Subscription ${subscriptionExternalId} already exists (${existing.id}), updating status`,
        );
        const updatedStatus = new CreateSubscriptionFromPaymentGatewayDto(
          payload,
        ).status;
        const updated = await this.update(existing.id, {
          status: updatedStatus,
          is_active: updatedStatus === SubscriptionStatus.ACTIVE,
        });
        return {
          eventType,
          subscriptionCreated: false,
          subscription: {
            subscriptionId: updated.id,
            status: updated.status,
            isActive: updated.is_active,
            userId: updated.user_id,
            subscriptionPlanId: updated.subscription_plan_id,
          },
        };
      }

      const subscription = await this.createSubscriptionFromPaymentGatewayEvent(
        payload,
        user,
        plan,
      );

      return {
        eventType,
        subscriptionCreated: true,
        subscription: {
          subscriptionId: subscription?.id,
          status: subscription?.status,
          isActive: subscription?.is_active,
          userId: subscription?.user_id,
          subscriptionPlanId: subscription?.subscription_plan_id,
        },
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
    user?: User,
    plan?: SubscriptionPlan,
  ): Promise<UserSubscription> {
    try {
      const subscriptionData = new CreateSubscriptionFromPaymentGatewayDto(
        payload,
      );

      // Override user_id and plan from resolved entities if available
      if (user?.id) subscriptionData.user_id = user.id;
      if (plan?.id) subscriptionData.subscription_plan_id = plan.id;

      // Fix subscription external ID disambiguation
      const externalSubId =
        payload?.data?.attributes?.subscription_id?.toString() ||
        payload?.data?.id;
      subscriptionData.payment_gateway_subscription_id = externalSubId;

      this.logger.log('Creating subscription from payment gateway event', {
        subscriptionData,
      });
      return await this.create(subscriptionData);
    } catch (error) {
      this.logger.error(
        'Failed to create subscription from payment gateway event',
        error,
      );
      throw error;
    }
  }

  //#endregion
}
