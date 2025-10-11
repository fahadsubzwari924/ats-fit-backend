import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentHistory } from '../../../database/entities/payment-history.entity';
import { UserService } from '../../user/user.service';
import { SubscriptionPlanService } from './subscription-plan.service';
import { PaymentStatus, PaymentType } from '../enums/payment.enum';
import { PaymentConfirmationDto } from '../dtos/payment-confirmation.dto';

@Injectable()
export class PaymentHistoryService {
  private readonly logger = new Logger(PaymentHistoryService.name);

  constructor(
    @InjectRepository(PaymentHistory)
    private paymentHistoryRepository: Repository<PaymentHistory>,
    private userService: UserService,
    private subscriptionPlanService: SubscriptionPlanService,
  ) {}

  /**
   * Create payment history record from LemonSqueezy webhook
   */
//   WebhookEventDto
  async paymentConfirmation(webhookData: any): Promise<PaymentHistory> {
    try {
      this.logger.log(`payment-history.service -> paymentConfirmation -> Creating payment history from webhook: ${webhookData.meta?.event_name}`);
      this.logger.log(`payment-history.service -> paymentConfirmation -> Webhook data preview:`, {
        event: webhookData.meta?.event_name,
        lemonSqueezyId: webhookData.data?.id,
        hasCustomData: !!webhookData.data?.attributes?.custom_data,
        hasCheckoutData: !!webhookData.data?.attributes?.checkout_data
      });

      // Check if already exists
      const existingPayment = await this.paymentHistoryRepository.findOne({
        where: { external_payment_id: webhookData.data?.id }
      });

      if (existingPayment) {
        this.logger.log(`Payment history already exists: ${existingPayment.id}`);
        return existingPayment;
      }

      const paymentHistory = new PaymentHistory();
      
      // Store complete payment gateway response
      paymentHistory.payment_gateway_response = webhookData as any;

      // Extract basic information
      paymentHistory.external_payment_id = webhookData.data?.id;
      paymentHistory.status = this.mapWebhookStatus(webhookData.data?.attributes?.status);
      paymentHistory.payment_type = this.determinePaymentType(webhookData.meta?.event_name);
      paymentHistory.is_test_mode = webhookData.meta?.test_mode || false;
      paymentHistory.customer_email = webhookData.data.attributes.user_email;

      // Extract custom data from various possible locations in LemonSqueezy webhook
      const customData = this.extractCustomData(webhookData);
      

      // Extract user information
      if (customData) {
        
        // Try to find user by email
        try {
          const user = await this.userService.getUserById(customData?.user_id);
          if (user) {
            paymentHistory.user_id = user.id;
          }
        } catch (error) {
          this.logger.warn(`User not found for user id: ${webhookData?.meta?.custom_data?.user_id}`);
        }
      }

      
      // Extract custom user ID if provided
      if (customData?.user_id && !paymentHistory.user_id) {
        paymentHistory.user_id = customData.user_id;
        this.logger.log(`Found user ID in custom data: ${customData.user_id}`);
      }
      
      // Extract plan ID if provided in custom data
      if (customData?.plan_id && !paymentHistory.subscription_plan_id) {
        try {
          const subscriptionPlan = await this.subscriptionPlanService.findById(customData.plan_id);
          if (subscriptionPlan) {
            paymentHistory.subscription_plan_id = subscriptionPlan.id;
            this.logger.log(`Linked payment to subscription plan via custom data: ${subscriptionPlan.id}`);
          }
        } catch (error) {
          this.logger.warn(`Subscription plan not found for custom plan ID: ${customData.plan_id}`);
        }
      }

      
      // Store custom data in metadata for reference
      if (customData) {
        paymentHistory.metadata = {
          ...(paymentHistory.metadata || {}),
          customData
        };
      }

      // Extract amount and currency
      const amountInCents = webhookData.data?.attributes?.total || 
                           webhookData.data?.attributes?.subtotal ||
                           webhookData.data?.attributes?.total_usd;
      if (amountInCents) {
        paymentHistory.amount = parseFloat((amountInCents / 100).toFixed(2));
      }

      paymentHistory.currency = webhookData.data?.attributes?.currency || 'USD';

      // Link to subscription plan if variant ID is available
      const variantId = webhookData.data?.attributes?.first_order_item?.variant_id;
      if (variantId) {
        try {
          const subscriptionPlan = await this.subscriptionPlanService.findByExternalVariantId(variantId.toString());
          if (subscriptionPlan) {
            paymentHistory.subscription_plan_id = subscriptionPlan.id;
            this.logger.log(`Linked payment to subscription plan: ${subscriptionPlan.id}`);
          }
        } catch (error) {
          this.logger.warn(`Subscription plan not found for variant ID: ${variantId}`);
        }
      }

      const savedPayment = await this.paymentHistoryRepository.save(paymentHistory);
      
      this.logger.log(`Payment history created successfully: ${savedPayment.id}`);
      return savedPayment;

    } catch (error) {
      this.logger.error('Failed to create payment history from webhook', error);
      throw error;
    }
  }

  /**
   * Find payment history by External Payment ID
   */
  async findByExternalPaymentId(externalPaymentId: string): Promise<PaymentHistory | null> {
    return await this.paymentHistoryRepository.findOne({
      where: { external_payment_id: externalPaymentId },
      relations: ['user', 'subscriptionPlan']
    });
  }

  /**
   * Find payment history by user ID
   */
  async findByUserId(userId: string): Promise<PaymentHistory[]> {
    return await this.paymentHistoryRepository.find({
      where: { user_id: userId },
      relations: ['subscriptionPlan'],
      order: { created_at: 'DESC' }
    });
  }

  /**
   * Find payment history by subscription plan
   */
  async findBySubscriptionPlan(subscriptionPlanId: string): Promise<PaymentHistory[]> {
    return await this.paymentHistoryRepository.find({
      where: { subscription_plan_id: subscriptionPlanId },
      relations: ['user'],
      order: { created_at: 'DESC' }
    });
  }

  /**
   * Mark payment as processed
   */
  async markAsProcessed(paymentId: string): Promise<void> {
    const payment = await this.paymentHistoryRepository.findOne({
      where: { id: paymentId }
    });

    if (payment) {
      payment.markAsProcessed();
      await this.paymentHistoryRepository.save(payment);
    }
  }

  /**
   * Mark payment as failed
   */
  async markAsFailed(paymentId: string, error: string): Promise<void> {
    const payment = await this.paymentHistoryRepository.findOne({
      where: { id: paymentId }
    });

    if (payment) {
      payment.markAsFailed(error);
      await this.paymentHistoryRepository.save(payment);
    }
  }

  /**
   * Get payment statistics
   */
  async getPaymentStats(userId?: string) {
    const whereCondition = userId ? { user_id: userId } : {};
    
    const [totalPayments, successfulPayments, totalRevenue] = await Promise.all([
      this.paymentHistoryRepository.count({ where: whereCondition }),
      this.paymentHistoryRepository.count({ 
        where: { ...whereCondition, status: PaymentStatus.SUCCESS } 
      }),
      this.paymentHistoryRepository
        .createQueryBuilder('payment')
        .select('SUM(payment.amount)', 'sum')
        .where('payment.status = :status', { status: PaymentStatus.SUCCESS })
        .andWhere(userId ? 'payment.user_id = :userId' : '1=1', { userId })
        .getRawOne()
    ]);

    return {
      totalPayments,
      successfulPayments,
      failedPayments: totalPayments - successfulPayments,
      totalRevenue: parseFloat(totalRevenue?.sum || '0'),
      successRate: totalPayments > 0 ? (successfulPayments / totalPayments) * 100 : 0
    };
  }

  /**
   * Map LemonSqueezy webhook status to our PaymentStatus enum
   */
  private mapWebhookStatus(webhookStatus: string): PaymentStatus {
    if (!webhookStatus) return PaymentStatus.PENDING;

    const statusMap: Record<string, PaymentStatus> = {
      'paid': PaymentStatus.SUCCESS,
      'active': PaymentStatus.SUCCESS,
      'cancelled': PaymentStatus.CANCELLED,
      'expired': PaymentStatus.EXPIRED,
      'failed': PaymentStatus.FAILED,
      'refunded': PaymentStatus.REFUNDED,
      'pending': PaymentStatus.PENDING,
    };

    return statusMap[webhookStatus.toLowerCase()] || PaymentStatus.PENDING;
  }

  /**
   * Determine payment type from event name
   */
  private determinePaymentType(eventName: string): PaymentType {
    if (!eventName) return PaymentType.ONE_TIME;

    if (eventName.includes('subscription')) {
      return PaymentType.SUBSCRIPTION;
    } else if (eventName.includes('refund')) {
      return PaymentType.REFUND;
    } else {
      return PaymentType.ONE_TIME;
    }
  }

  /**
   * Extract custom data from LemonSqueezy webhook payload
   * LemonSqueezy returns custom data in different locations depending on the event type
   */
  private extractCustomData(webhookData: PaymentConfirmationDto): Record<string, any> | null {
    try {
      // Cast to any to access dynamic properties that might not be in the DTO interface
      const payload = webhookData as any;
      
      // Try different possible locations for custom data
      const possibleLocations = [
        payload.data?.attributes?.custom_data,
        payload.data?.attributes?.checkout_data?.custom,
        payload.data?.attributes?.checkout_data?.custom_data,
        payload.meta?.custom_data,
        payload.data?.relationships?.subscription?.data?.attributes?.custom_data,
        // For order-related events
        payload.data?.attributes?.first_order_item?.custom_data,
        // For subscription events  
        payload.data?.attributes?.subscription?.custom_data,
      ];

      for (const location of possibleLocations) {
        if (location && typeof location === 'object' && Object.keys(location).length > 0) {
          this.logger.log(`Found custom data in webhook:`, location);
          return location;
        }
      }

      // If no structured custom data found, check for string-based custom data
      const customDataString = payload.data?.attributes?.custom_data_string ||
                              payload.data?.attributes?.checkout_data?.custom_string;
      
      if (customDataString) {
        try {
          const parsed = JSON.parse(customDataString);
          this.logger.log(`Found custom data string in webhook:`, parsed);
          return parsed;
        } catch (error) {
          this.logger.warn(`Failed to parse custom data string: ${customDataString}`);
        }
      }

      this.logger.log('No custom data found in webhook payload');
      return null;
    } catch (error) {
      this.logger.error('Error extracting custom data from webhook:', error);
      return null;
    }
  }
}