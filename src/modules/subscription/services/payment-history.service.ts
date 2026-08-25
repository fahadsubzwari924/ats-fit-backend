import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentHistory } from '../../../database/entities/payment-history.entity';
import { SubscriptionPlan, User } from '../../../database/entities';
import { PaymentStatus, PaymentType, Currency } from '../enums/payment.enum';
import { PaymentEventType } from '../enums/payment-event-type.enum';
import { NormalizedWebhookEvent } from '../externals/interfaces/normalized-webhook-event.interface';
import { PaymentClaimResult } from '../interfaces/payment-claim-result.interface';
import { OrderBy, OrderByType } from '../../../shared/types/order-by.type';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { IdValidator } from '../../../shared/validators/id.validator';
import { redactCustomerPii } from '../utils/redact-customer-pii.util';

/** A claim older than this is dead (crashed handler / restart) and becomes
 * reclaimable. Stays well below Creem's retry cadence (30s/1m/5m/1h). */
const CLAIM_STALE_INTERVAL = '2 minutes';

/**
 * Exhaustive event-type -> status map so every row gets an explicit status
 * instead of silently staying at the column's `PENDING` default. `UNKNOWN`
 * maps to PENDING deliberately (an honest "don't know"), not as a fallthrough.
 */
const EVENT_TYPE_TO_STATUS: Record<PaymentEventType, PaymentStatus> = {
  [PaymentEventType.SUBSCRIPTION_ACTIVATED]: PaymentStatus.SUCCESS,
  [PaymentEventType.SUBSCRIPTION_RENEWED]: PaymentStatus.SUCCESS,
  [PaymentEventType.SUBSCRIPTION_TRIALING]: PaymentStatus.SUCCESS,
  [PaymentEventType.SUBSCRIPTION_PAYMENT_FAILED]: PaymentStatus.FAILED,
  [PaymentEventType.SUBSCRIPTION_CANCEL_SCHEDULED]: PaymentStatus.SUCCESS,
  [PaymentEventType.SUBSCRIPTION_CANCELLED]: PaymentStatus.CANCELLED,
  [PaymentEventType.SUBSCRIPTION_EXPIRED]: PaymentStatus.EXPIRED,
  [PaymentEventType.SUBSCRIPTION_PAUSED]: PaymentStatus.SUCCESS,
  [PaymentEventType.SUBSCRIPTION_UPDATED]: PaymentStatus.SUCCESS,
  [PaymentEventType.PAYMENT_REFUNDED]: PaymentStatus.REFUNDED,
  [PaymentEventType.PAYMENT_DISPUTED]: PaymentStatus.FAILED,
  [PaymentEventType.UNKNOWN]: PaymentStatus.PENDING,
};

/** Exhaustive companion map for the NOT NULL `payment_type` column. */
const EVENT_TYPE_TO_PAYMENT_TYPE: Record<PaymentEventType, PaymentType> = {
  [PaymentEventType.SUBSCRIPTION_ACTIVATED]: PaymentType.SUBSCRIPTION,
  [PaymentEventType.SUBSCRIPTION_RENEWED]: PaymentType.SUBSCRIPTION,
  [PaymentEventType.SUBSCRIPTION_TRIALING]: PaymentType.SUBSCRIPTION,
  [PaymentEventType.SUBSCRIPTION_PAYMENT_FAILED]: PaymentType.SUBSCRIPTION,
  [PaymentEventType.SUBSCRIPTION_CANCEL_SCHEDULED]: PaymentType.SUBSCRIPTION,
  [PaymentEventType.SUBSCRIPTION_CANCELLED]: PaymentType.SUBSCRIPTION,
  [PaymentEventType.SUBSCRIPTION_EXPIRED]: PaymentType.SUBSCRIPTION,
  [PaymentEventType.SUBSCRIPTION_PAUSED]: PaymentType.SUBSCRIPTION,
  [PaymentEventType.SUBSCRIPTION_UPDATED]: PaymentType.SUBSCRIPTION,
  [PaymentEventType.PAYMENT_REFUNDED]: PaymentType.REFUND,
  [PaymentEventType.PAYMENT_DISPUTED]: PaymentType.REFUND,
  [PaymentEventType.UNKNOWN]: PaymentType.ONE_TIME,
};

interface ClaimQueryRow {
  id: string;
  inserted: boolean;
}

@Injectable()
export class PaymentHistoryService {
  private readonly logger = new Logger(PaymentHistoryService.name);

  constructor(
    @InjectRepository(PaymentHistory)
    private paymentHistoryRepository: Repository<PaymentHistory>,
  ) {}

  /**
   * Atomic replay gate for the public, unauthenticated payment webhook.
   * Reserves (or recognises as already-owned/duplicate) the `payment_history`
   * row for `event.gatewayTransactionId` via one conditional UPSERT — see
   * `1815400000000-AddProcessingClaimedAtToPaymentHistory`. No transaction is
   * held across this call and the caller's handler: claim and
   * `markAsProcessed` are each atomic alone; wrapping the handler (which
   * calls AWS SES) in a DB transaction would be false atomicity that pins a
   * pooled connection for no benefit.
   *
   * `plan` must already be resolved by the caller and passed in (resolved
   * once, in the controller). Money is sourced only from `plan`, never from
   * the webhook payload.
   */
  async claimPaymentEvent(
    event: NormalizedWebhookEvent,
    user: Pick<User, 'id' | 'email'>,
    plan: SubscriptionPlan | null,
  ): Promise<PaymentClaimResult> {
    const transactionId = event.gatewayTransactionId;
    if (!transactionId) {
      throw new BadRequestException(
        'Webhook event is missing a gateway transaction id',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const { amount, currency } = this.resolveAmountAndCurrency(plan, event);
    const status = EVENT_TYPE_TO_STATUS[event.type];
    const paymentType = EVENT_TYPE_TO_PAYMENT_TYPE[event.type];
    const metadata = this.buildAuditMetadata(event, user);
    // GDPR Art. 5(1)(c) data minimisation: never persist the webhook's raw
    // customer contact fields a second time — `customer_email` below is the
    // one intentional, purpose-built copy. `redactCustomerPii` deep-clones
    // as it walks, so `event.raw` itself is left untouched for any other
    // reader of this event. See that function's doc comment for the full
    // rationale and why a nested `customer` object is caught recursively
    // rather than at one hard-coded path.
    const redactedPayload = redactCustomerPii(event.raw);

    const claimRows: ClaimQueryRow[] =
      await this.paymentHistoryRepository.query(
        `
      INSERT INTO payment_history (
        payment_gateway_transaction_id, amount, currency, status, payment_type,
        user_id, subscription_plan_id, payment_gateway_response, customer_email,
        is_test_mode, metadata, processing_claimed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, now())
      ON CONFLICT (payment_gateway_transaction_id)
      DO UPDATE SET processing_claimed_at = now()
      WHERE payment_history.processed_at IS NULL
        AND (
          payment_history.processing_claimed_at IS NULL
          OR payment_history.processing_claimed_at < now() - interval '${CLAIM_STALE_INTERVAL}'
        )
      RETURNING id, (xmax = 0) AS inserted
      `,
        [
          transactionId,
          amount,
          currency,
          status,
          paymentType,
          user.id,
          plan?.id ?? null,
          JSON.stringify(redactedPayload ?? {}),
          event.customerEmail ?? null,
          event.isTestMode,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );

    if (claimRows.length === 0) {
      const existing = await this.findByExternalPaymentId(transactionId);
      if (!existing) {
        // The UPSERT reported a conflict (0 rows) but no row now exists for
        // this transaction id — should be unreachable. Fail loudly rather
        // than fabricate a row; a wrong "duplicate" here would silently drop
        // a legitimate event.
        this.logger.error(
          `Claim conflict for transaction ${transactionId} could not be resolved to an existing row`,
        );
        throw new InternalServerErrorException(
          'Payment history claim conflict could not be resolved',
          ERROR_CODES.INTERNAL_SERVER,
        );
      }
      return { outcome: 'duplicate', row: existing };
    }

    const { id, inserted } = claimRows[0];
    const row = await this.paymentHistoryRepository.findOne({ where: { id } });
    if (!row) {
      throw new InternalServerErrorException(
        `Claimed payment history row ${id} vanished before it could be read back`,
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    return { outcome: inserted ? 'reserved' : 'retry', row };
  }

  /**
   * `payment_history.amount`/`currency` are the plan's list price, not the
   * charged price — discounts and grandfathered pricing make them diverge.
   * This is not a ledger; Creem is authoritative for disputes, refunds, and
   * tax. Sourcing from our own `subscription_plans` row (rather than the
   * webhook payload, which does not reliably carry price) avoids persisting
   * an attacker- or provider-quirk-controlled amount into a financial table.
   */
  private resolveAmountAndCurrency(
    plan: SubscriptionPlan | null,
    event: NormalizedWebhookEvent,
  ): { amount: number; currency: string } {
    if (!plan) {
      this.logger.error(
        `No subscription plan resolved for transaction ${event.gatewayTransactionId} ` +
          `(gatewayProductId=${event.gatewayProductId}) — recording amount=0`,
      );
      return { amount: 0, currency: Currency.USD };
    }
    return { amount: plan.price, currency: plan.currency };
  }

  /**
   * The only thing this service ever writes to `metadata` is the
   * email-mismatch audit signal — data for humans to review, never a gate on
   * processing (requirement 5). `metadata.email` from the original checkout
   * is never read here for any lookup.
   */
  private buildAuditMetadata(
    event: NormalizedWebhookEvent,
    user: Pick<User, 'id' | 'email'>,
  ): Record<string, unknown> | null {
    if (
      !event.customerEmail ||
      !user.email ||
      event.customerEmail.toLowerCase() === user.email.toLowerCase()
    ) {
      return null;
    }

    this.logger.warn(
      `Customer email on webhook (${event.customerEmail}) does not match resolved ` +
        `user email for transaction ${event.gatewayTransactionId}. Recording as an ` +
        `audit signal only — this never gates processing.`,
    );

    return {
      emailMismatch: {
        resolvedUserEmail: user.email,
        gatewayCustomerEmail: event.customerEmail,
      },
    };
  }

  /**
   * Find payment history by External Payment ID
   */
  async findByExternalPaymentId(
    externalPaymentId: string,
    entityRelations?: string[],
  ): Promise<PaymentHistory | null> {
    // Guard clause: Validate externalPaymentId
    if (!externalPaymentId || externalPaymentId.trim() === '') {
      this.logger.warn(
        'findByExternalPaymentId called with invalid externalPaymentId:',
        externalPaymentId,
      );
      return null;
    }

    return await this.paymentHistoryRepository.findOne({
      where: { payment_gateway_transaction_id: externalPaymentId.trim() },
      relations: entityRelations,
    });
  }

  /**
   * Find payment history by user ID
   */
  async findByUserId(
    userId: string,
    orderBy: OrderByType = OrderBy.DESC,
  ): Promise<PaymentHistory[] | null> {
    // Guard clause: Validate userId
    if (!userId || userId.trim() === '') {
      this.logger.warn('findByUserId called with invalid userId:', userId);
      return null;
    }

    return await this.paymentHistoryRepository.find({
      where: { user_id: userId.trim() },
      relations: ['subscription_plan'],
      order: { created_at: orderBy },
    });
  }

  /**
   * Mark payment as processed. Must only be called after the routed handler
   * has succeeded — never between the claim and a successful handler run, or
   * a failure gets silently reported as done and Creem stops retrying it.
   */
  async markAsProcessed(paymentId: string): Promise<void> {
    const validatedPaymentId = IdValidator.validateId(paymentId, 'Payment ID');

    const payment = await this.paymentHistoryRepository.findOne({
      where: { id: validatedPaymentId },
    });

    if (!payment) {
      throw new BadRequestException(
        `Payment not found with ID: ${validatedPaymentId}`,
        ERROR_CODES.NOT_FOUND,
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
        ERROR_CODES.BAD_REQUEST,
      );
    }

    const payment = await this.paymentHistoryRepository.findOne({
      where: { id: validatedPaymentId },
    });

    if (!payment) {
      throw new BadRequestException(
        `Payment not found with ID: ${validatedPaymentId}`,
        ERROR_CODES.NOT_FOUND,
      );
    }

    payment.markAsFailed(error.trim());
    await this.paymentHistoryRepository.save(payment);
    this.logger.log(`Payment marked as failed: ${payment.id}, Error: ${error}`);
  }
}
