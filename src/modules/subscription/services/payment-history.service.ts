import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentHistory } from '../../../database/entities/payment-history.entity';
import { UserService } from '../../user/user.service';
import { SubscriptionPlanService } from './subscription-plan.service';
import { PaymentStatus, PaymentType } from '../enums/payment.enum';
import { PaymentConfirmationDto } from '../dtos/payment-confirmation.dto';
import { OrderBy, OrderByType } from '../../../shared/types/order-by.type';
import { BadRequestException, InternalServerErrorException } from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { IdValidator } from '../../../shared/validators/id.validator';

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
   * Create payment history record from payment gateway notification
   */
  async paymentConfirmation(paymentGatewayData: any): Promise<PaymentHistory> {
    try {
      this.validatePaymentGatewayData(paymentGatewayData);
      
      const existingPayment = await this.checkExistingPayment(paymentGatewayData);
      if (existingPayment) {
        return existingPayment;
      }

      const paymentHistory = await this.createPaymentHistoryFromGatewayData(paymentGatewayData);
      const savedPayment = await this.paymentHistoryRepository.save(paymentHistory);
      
      this.logger.log(`Payment history created successfully: ${savedPayment.id}`);
      return savedPayment;
      
    } catch (error) {
      this.logger.error('Failed to create payment history from payment gateway notification', error);
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to process payment confirmation',
        ERROR_CODES.INTERNAL_SERVER
      );
    }
  }

  /**
   * Validate payment gateway notification data structure
   */
  private validatePaymentGatewayData(paymentGatewayData: any): void {
    if (!paymentGatewayData || typeof paymentGatewayData !== 'object') {
      throw new BadRequestException(
        'Invalid payment gateway data provided',
        ERROR_CODES.BAD_REQUEST
      );
    }

    if (!paymentGatewayData.data?.id) {
      throw new BadRequestException(
        'Missing payment ID in payment gateway data',
        ERROR_CODES.BAD_REQUEST
      );
    }

    if (!paymentGatewayData.meta?.event_name) {
      throw new BadRequestException(
        'Missing event name in payment gateway data',
        ERROR_CODES.BAD_REQUEST
      );
    }
  }

  /**
   * Check if payment already exists
   */
  private async checkExistingPayment(paymentGatewayData: any): Promise<PaymentHistory | null> {
    const existingPayment = await this.findByExternalPaymentId(paymentGatewayData.data?.id);
    if (existingPayment) {
      this.logger.log(`Payment history already exists: ${existingPayment.id}`);
    }
    return existingPayment;
  }

  /**
   * Create payment history entity from payment gateway notification data
   */
  private async createPaymentHistoryFromGatewayData(paymentGatewayData: any): Promise<PaymentHistory> {
    const paymentHistory = new PaymentHistory();
    
    this.setBasicPaymentData(paymentHistory, paymentGatewayData);
    await this.setUserInformation(paymentHistory, paymentGatewayData);
    await this.setSubscriptionPlanInformation(paymentHistory, paymentGatewayData);
    this.setAmountAndCurrency(paymentHistory, paymentGatewayData);
    
    return paymentHistory;
  }

  /**
   * Set basic payment information
   */
  private setBasicPaymentData(paymentHistory: PaymentHistory, paymentGatewayData: any): void {
    paymentHistory.payment_gateway_response = paymentGatewayData;
    paymentHistory.external_payment_id = paymentGatewayData.data?.id;
    paymentHistory.status = this.mapPaymentGatewayStatus(paymentGatewayData.data?.attributes?.status);
    paymentHistory.payment_type = this.determinePaymentType(paymentGatewayData.meta?.event_name);
    paymentHistory.is_test_mode = paymentGatewayData.meta?.test_mode || false;
    paymentHistory.customer_email = paymentGatewayData.data.attributes.user_email;
  }

  /**
   * Set user information from payment gateway notification data
   */
  private async setUserInformation(paymentHistory: PaymentHistory, paymentGatewayData: any): Promise<void> {
    const customData = this.extractCustomData(paymentGatewayData);
    
    if (customData?.user_id) {
      const user = await this.findUserSafely(customData.user_id);
      if (user) {
        paymentHistory.user_id = user.id;
        this.logger.log(`Found user ID in custom data: ${customData.user_id}`);
      }
    }

    // Store custom data in metadata
    if (customData) {
      paymentHistory.metadata = {
        ...(paymentHistory.metadata || {}),
        customData
      };
    }
  }

  /**
   * Set subscription plan information
   */
  private async setSubscriptionPlanInformation(paymentHistory: PaymentHistory, paymentGatewayData: any): Promise<void> {
    const customData = this.extractCustomData(paymentGatewayData);
    
    // Try from custom data first
    if (customData?.plan_id) {
      const plan = await this.findSubscriptionPlanSafely(customData.plan_id);
      if (plan) {
        paymentHistory.subscription_plan_id = plan.id;
        this.logger.log(`Linked payment to subscription plan via custom data: ${plan.id}`);
        return;
      }
    }

    // Try from variant ID
    const variantId = paymentGatewayData.data?.attributes?.first_order_item?.variant_id;
    if (variantId) {
      const plan = await this.findSubscriptionPlanByVariantSafely(variantId.toString());
      if (plan) {
        paymentHistory.subscription_plan_id = plan.id;
        this.logger.log(`Linked payment to subscription plan: ${plan.id}`);
      }
    }
  }

  /**
   * Set amount and currency information
   */
  private setAmountAndCurrency(paymentHistory: PaymentHistory, paymentGatewayData: any): void {
    const amountInCents = paymentGatewayData.data?.attributes?.total || 
                         paymentGatewayData.data?.attributes?.subtotal ||
                         paymentGatewayData.data?.attributes?.total_usd;
    
    if (amountInCents) {
      paymentHistory.amount = parseFloat((amountInCents / 100).toFixed(2));
    }

    paymentHistory.currency = paymentGatewayData.data?.attributes?.currency || 'USD';
  }

  /**
   * Safely find user without throwing exceptions
   */
  private async findUserSafely(userId: string): Promise<any | null> {
    const validatedUserId = IdValidator.validateId(userId, 'User ID');
    const user = await this.userService.getUserById(validatedUserId);
    return user;
  }

  /**
   * Safely find subscription plan without throwing exceptions
   */
  private async findSubscriptionPlanSafely(planId: string): Promise<any | null> {
    const plan = await this.subscriptionPlanService.findById(planId);
    return plan;
  }

  /**
   * Safely find subscription plan by variant without throwing exceptions
   */
  private async findSubscriptionPlanByVariantSafely(variantId: string): Promise<any | null> {
    const plan = await this.subscriptionPlanService.findByExternalVariantId(variantId);
    return plan;
  }

  /**
   * Find payment history by External Payment ID
   */
  async findByExternalPaymentId(externalPaymentId: string, entityRelations?: string[]): Promise<PaymentHistory | null> {
    // Guard clause: Validate externalPaymentId
    if (!externalPaymentId || externalPaymentId.trim() === '') {
      this.logger.warn('findByExternalPaymentId called with invalid externalPaymentId:', externalPaymentId);
      return null;
    }
    
    return await this.paymentHistoryRepository.findOne({
      where: { external_payment_id: externalPaymentId.trim() },
      relations: entityRelations
    });
  }

  /**
   * Find payment history by user ID
   */
  async findByUserId(userId: string, orderBy: OrderByType = OrderBy.DESC): Promise<PaymentHistory[] | null> {
    // Guard clause: Validate userId
    if (!userId || userId.trim() === '') {
      this.logger.warn('findByUserId called with invalid userId:', userId);
      return null;
    }

    return await this.paymentHistoryRepository.find({
      where: { user_id: userId.trim() },
      relations: ['subscriptionPlan'],
      order: { created_at: orderBy }
    });
  }

  /**
   * Find payment history by subscription plan
   */
  async findBySubscriptionPlan(subscriptionPlanId: string, orderBy: OrderByType = OrderBy.DESC): Promise<PaymentHistory[] | null> {
    // Guard clause: Validate subscriptionPlanId
    if (!subscriptionPlanId || subscriptionPlanId.trim() === '') {
      this.logger.warn('findBySubscriptionPlan called with invalid subscriptionPlanId:', subscriptionPlanId);
      return null;
    }

    return await this.paymentHistoryRepository.find({
      where: { subscription_plan_id: subscriptionPlanId.trim() },
      relations: ['user'],
      order: { created_at: orderBy }
    });
  }

  /**
   * Mark payment as processed
   */
  async markAsProcessed(paymentId: string): Promise<void> {
    const validatedPaymentId = IdValidator.validateId(paymentId, 'Payment ID');

    const payment = await this.paymentHistoryRepository.findOne({
      where: { id: validatedPaymentId }
    });

    if (!payment) {
      throw new BadRequestException(
        `Payment not found with ID: ${validatedPaymentId}`,
        ERROR_CODES.NOT_FOUND
      );
    }

    payment.markAsProcessed();
    await this.paymentHistoryRepository.save(payment);
    this.logger.log(`Payment marked as processed: ${payment.id}`);
  }

  /**
   * Mark payment as failed
   */
  async markAsFailed(paymentId: string, error: string): Promise<void> {
    const validatedPaymentId = IdValidator.validateId(paymentId, 'Payment ID');
    
    if (!error || error.trim() === '') {
      throw new BadRequestException(
        'Error message is required and cannot be empty',
        ERROR_CODES.BAD_REQUEST
      );
    }

    const payment = await this.paymentHistoryRepository.findOne({
      where: { id: validatedPaymentId }
    });

    if (!payment) {
      throw new BadRequestException(
        `Payment not found with ID: ${validatedPaymentId}`,
        ERROR_CODES.NOT_FOUND
      );
    }

    payment.markAsFailed(error.trim());
    await this.paymentHistoryRepository.save(payment);
    this.logger.log(`Payment marked as failed: ${payment.id}, Error: ${error}`);
  }

  /**
   * Get payment statistics
   */
  async getPaymentStats(userId?: string) {
    const validUserId = userId ? IdValidator.validateId(userId, 'User ID') : undefined;
    const whereCondition = validUserId ? { user_id: validUserId } : {};
    
    const [totalPayments, successfulPayments, totalRevenue] = await Promise.all([
      this.paymentHistoryRepository.count({ where: whereCondition }),
      this.paymentHistoryRepository.count({ 
        where: { ...whereCondition, status: PaymentStatus.SUCCESS } 
      }),
      this.paymentHistoryRepository
        .createQueryBuilder('payment')
        .select('SUM(payment.amount)', 'sum')
        .where('payment.status = :status', { status: PaymentStatus.SUCCESS })
        .andWhere(validUserId ? 'payment.user_id = :userId' : '1=1', { userId: validUserId })
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
   * Map payment gateway status to our internal PaymentStatus enum
   */
  private mapPaymentGatewayStatus(paymentGatewayStatus: string): PaymentStatus {
    // Guard clause: Handle invalid or missing status
    if (!paymentGatewayStatus || paymentGatewayStatus.trim() === '') {
      this.logger.warn('mapPaymentGatewayStatus called with invalid status:', paymentGatewayStatus);
      return PaymentStatus.PENDING;
    }

    const gatewayStatusMap: Record<string, PaymentStatus> = {
      'paid': PaymentStatus.SUCCESS,
      'active': PaymentStatus.SUCCESS,
      'cancelled': PaymentStatus.CANCELLED,
      'expired': PaymentStatus.EXPIRED,
      'failed': PaymentStatus.FAILED,
      'refunded': PaymentStatus.REFUNDED,
      'pending': PaymentStatus.PENDING,
    };

    const normalizedStatus = paymentGatewayStatus.toLowerCase().trim();
    const mappedStatus = gatewayStatusMap[normalizedStatus];
    
    if (!mappedStatus) {
      this.logger.warn(`Unknown payment gateway status received: ${paymentGatewayStatus}, defaulting to PENDING`);
      return PaymentStatus.PENDING;
    }

    return mappedStatus;
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
   * Extract custom data from payment gateway notification payload
   * Payment gateways return custom data in different locations depending on the event type
   */
  private extractCustomData(paymentGatewayData: PaymentConfirmationDto): Record<string, any> | null {
    try {
      // Cast to any to access dynamic properties that might not be in the DTO interface
      const payload = paymentGatewayData as any;
      
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
          this.logger.log(`Found custom data in payment gateway notification:`, location);
          return location;
        }
      }

      // If no structured custom data found, check for string-based custom data
      const customDataString = payload.data?.attributes?.custom_data_string ||
                              payload.data?.attributes?.checkout_data?.custom_string;
      
      if (customDataString) {
        try {
          const parsed = JSON.parse(customDataString);
          this.logger.log(`Found custom data string in payment gateway notification:`, parsed);
          return parsed;
        } catch (error) {
          this.logger.warn(`Failed to parse custom data string: ${customDataString}`);
        }
      }

      this.logger.log('No custom data found in payment gateway notification payload');
      return null;
    } catch (error) {
      this.logger.error('Error extracting custom data from payment gateway notification:', error);
      return null;
    }
  }
  
}