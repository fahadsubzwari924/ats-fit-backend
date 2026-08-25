import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSubscription } from '../../../database/entities/user-subscription.entity';
import { SubscriptionStatus } from '../enums/subscription-status.enum';
import { PaymentEventType } from '../enums/payment-event-type.enum';
import { SubscriptionCancellationResponse } from '../models';
import {
  ICreateSubscriptionData,
  IUpdateSubscriptionData,
  IProcessPaymentGatewayEventResult,
  ISubscriptionSummary,
} from '../interfaces/subscription.interface';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { NormalizedWebhookEvent } from '../externals/interfaces/normalized-webhook-event.interface';
import { ConfigService } from '@nestjs/config';
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
import { PaymentService } from '../../../shared/services/payment.service';
import { MESSAGES } from '../../../shared/constants/messages';

/** Fallback subscription length when a normalized event omits `periodEnd`
 * (should not happen on a real creation event, but guards against ever
 * persisting an epoch or `Invalid Date` into `ends_at`). */
const DEFAULT_SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

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
        payment_gateway_customer_id: data.payment_gateway_customer_id,
        subscription_plan_id: data.subscription_plan_id,
        user_id: data.user_id,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        starts_at: data.starts_at,
        ends_at: data.ends_at,
        metadata: data.metadata,
        // `data.status` is itself derived from `event.type` (never
        // `event.status`) by the caller's status map, so this stays
        // compliant with "never derive is_active from event.status". A
        // brand-new subscription only ever gets created from an event that
        // maps to ACTIVE (activated/renewed/trialing) — cancel-scheduled
        // and deactivation events always target an *existing* row via
        // `update`/`updateByExternalId`, never this path.
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
    event: NormalizedWebhookEvent,
    user: User,
    plan: SubscriptionPlan,
  ): Promise<IProcessPaymentGatewayEventResult> {
    const result = await this.processPaymentGatewayEvent(event, user, plan);
    if (result.subscriptionCreated) {
      // Defense in depth: never trust the caller's own user resolution for
      // a plan-level grant — re-verify against the row itself before
      // upgrading anyone. Trivially true today (the row was just created
      // with user_id = user.id in this same call), but this guards against
      // a future caller/resolution bug without requiring a second review
      // of this method.
      const owns = await this.verifySubscriptionOwnership(
        event.gatewaySubscriptionId,
        user.id,
        event.eventId,
      );
      if (owns) {
        await this.userService.upgradeToPremium(user.id);
        this.logger.log(
          `User ${user.id} upgraded to premium after successful payment`,
        );
      }
    }
    return result;
  }

  async handleFailedPayment(
    event: NormalizedWebhookEvent,
    user: User,
    plan: SubscriptionPlan,
  ): Promise<void> {
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
            // Money comes from the resolved plan, never the webhook payload
            // (Task 9's rule for payment_history applies here too).
            amount: plan?.price,
            userName: user.full_name,
            planName: plan?.plan_name,
            attemptDate: new Date().toISOString(),
          },
          subject: EmailSubjects.PAYMENT_FAILED,
        },
      );

      this.logger.log('Payment failed email sent successfully', {
        userId: user?.id,
        eventId: event.eventId,
      });
    } catch (error) {
      this.logger.error('Failed to send payment failed email', {
        error,
        userId: user?.id,
        eventId: event.eventId,
      });
    }
  }

  /**
   * Handles a definitive loss of access: `subscription.cancelled` (immediate
   * cancel, no scheduled-cancel step occurred) or `subscription.expired`
   * (the period end of a previously scheduled cancellation). Both revoke
   * access now — the "still-entitled-but-cancelling" case is
   * `handleCancellationScheduled` below, which never reaches this method.
   */
  async handleSubscriptionDeactivated(
    event: NormalizedWebhookEvent,
    user: User,
  ): Promise<void> {
    try {
      const externalSubId = event.gatewaySubscriptionId;

      if (!externalSubId) {
        this.logger.warn(
          `Cannot process ${event.type}: no gatewaySubscriptionId on normalized event ${event.eventId}`,
        );
        return;
      }

      // `SUBSCRIPTION_EXPIRED` may follow a prior `cancel_scheduled` event
      // (is_cancelled already true) OR arrive on a natural lapse with no
      // prior user-initiated cancellation — leave is_cancelled/cancelled_at
      // untouched in that case rather than asserting a cancellation that
      // never happened. `SUBSCRIPTION_CANCELLED` is always an explicit,
      // immediate cancellation.
      const isCancelled =
        event.type === PaymentEventType.SUBSCRIPTION_CANCELLED;

      const updateData: IUpdateSubscriptionData = {
        status:
          this.eventTypeToPersistedStatus(event.type) ??
          SubscriptionStatus.EXPIRED,
        is_active: SubscriptionService.ACTIVATING_EVENT_TYPES.has(event.type),
        ...(isCancelled
          ? {
              is_cancelled: true,
              cancelled_at: event.cancelledAt ?? new Date(),
            }
          : {}),
      };

      await this.updateByExternalId(externalSubId, updateData);

      // The row update above is keyed on gatewaySubscriptionId alone and is
      // safe regardless of who the caller resolved as `user`. Revoking a
      // specific USER's plan is a different, higher-stakes action — never
      // trust the caller's resolution for that. Re-verify ownership first.
      const owns = await this.verifySubscriptionOwnership(
        externalSubId,
        user.id,
        event.eventId,
      );
      if (owns) {
        await this.userService.downgradeToFreemium(user.id);
      }

      this.logger.log(
        `Subscription ${externalSubId} deactivated (${event.type}, cancelled=${isCancelled}) for user ${user.id}`,
      );
    } catch (error) {
      this.logger.error('Failed to handle subscription deactivation', error);
      throw error;
    }
  }

  /**
   * Handles the generic `subscription.updated` event. Unlike the other
   * handlers, `SUBSCRIPTION_UPDATED` carries no unambiguous lifecycle
   * status by itself — `EVENT_TYPE_TO_SUBSCRIPTION_STATUS` maps it to
   * `null` deliberately, so `status`/`is_active` are left untouched here
   * rather than guessed.
   */
  async handleSubscriptionUpdated(
    event: NormalizedWebhookEvent,
  ): Promise<void> {
    try {
      const externalSubId = event.gatewaySubscriptionId;

      if (!externalSubId) {
        this.logger.warn(
          `Cannot process ${event.type}: no gatewaySubscriptionId on normalized event ${event.eventId}`,
        );
        return;
      }

      const existing = await this.findByExternalId(externalSubId);
      if (!existing) {
        this.logger.warn(
          `Cannot process ${event.type}: no subscription found for ${externalSubId} (event ${event.eventId})`,
        );
        return;
      }

      const persistedStatus = this.eventTypeToPersistedStatus(event.type);

      const updateData: IUpdateSubscriptionData = {
        ...(persistedStatus
          ? {
              status: persistedStatus,
              is_active: SubscriptionService.ACTIVATING_EVENT_TYPES.has(
                event.type,
              ),
            }
          : {}),
        ...(event.gatewayCustomerId
          ? { payment_gateway_customer_id: event.gatewayCustomerId }
          : {}),
        // Merge rather than replace — a blind overwrite of the jsonb column
        // would silently discard gatewayEventId/rawType/audit signals
        // (e.g. the email-mismatch marker) written by prior events.
        metadata: {
          ...(existing.metadata ?? {}),
          ...(event.metadata as Record<string, any>),
        },
      };

      await this.update(existing.id, updateData);

      this.logger.log(`Subscription ${externalSubId} updated (${event.type})`);
    } catch (error) {
      this.logger.error('Failed to handle subscription update', error);
      throw error;
    }
  }

  /**
   * Handles `subscription.cancel_scheduled`. The user paid for the current
   * period and keeps access until it ends — this must NOT call
   * `downgradeToFreemium`. Access is revoked later, when
   * `subscription.expired` arrives and routes to
   * `handleSubscriptionDeactivated`.
   */
  async handleCancellationScheduled(
    event: NormalizedWebhookEvent,
    user: User,
  ): Promise<void> {
    try {
      const externalSubId = event.gatewaySubscriptionId;

      if (!externalSubId) {
        this.logger.warn(
          `Cannot process ${event.type}: no gatewaySubscriptionId on normalized event ${event.eventId}`,
        );
        return;
      }

      await this.updateByExternalId(externalSubId, {
        status: SubscriptionStatus.SCHEDULED_CANCEL,
        is_cancelled: true,
        cancelled_at: event.cancelledAt ?? new Date(),
        // Deliberately left true — access is retained until period end.
        is_active: true,
      });

      this.logger.log(
        `Subscription ${externalSubId} scheduled for cancellation for user ${user.id}; access retained until period end`,
      );
    } catch (error) {
      this.logger.error('Failed to handle scheduled cancellation', error);
      throw error;
    }
  }

  /**
   * Handles `payment.disputed` (a chargeback) — the money is already gone.
   *
   * Deliberately does NOT change subscription status or `is_active`.
   * Whether a dispute should immediately revoke access is a business-policy
   * decision the product owner is deciding separately (partial/goodwill
   * disputes vs. outright fraud are not the same case, same reasoning that
   * keeps `PAYMENT_REFUNDED` mapped to `null` above).
   *
   * TODO: automated access revocation on dispute is pending that product
   * decision. Until then this only makes the event loud (error log) and
   * durable (a `disputedAt` marker merged into the row's metadata) so a
   * human can act on it — it must never be a silent no-op.
   */
  async handlePaymentDisputed(
    event: NormalizedWebhookEvent,
    user: User,
  ): Promise<void> {
    try {
      const externalSubId = event.gatewaySubscriptionId;

      if (!externalSubId) {
        this.logger.warn(
          `Cannot process ${event.type}: no gatewaySubscriptionId on normalized event ${event.eventId}`,
        );
        return;
      }

      this.logger.error(
        `Payment disputed (chargeback) for subscription ${externalSubId}, user ${user.id}, ` +
          `transaction ${event.gatewayTransactionId ?? 'unknown'} (event ${event.eventId}). ` +
          `Access has NOT been changed automatically — pending a product decision on automated ` +
          `revocation. Manual review required.`,
      );

      const existing = await this.findByExternalId(externalSubId);
      if (!existing) {
        this.logger.error(
          `Payment disputed for unknown local subscription ${externalSubId} (event ${event.eventId}) — no row to annotate`,
        );
        return;
      }

      await this.update(existing.id, {
        metadata: {
          ...(existing.metadata ?? {}),
          disputedAt: new Date().toISOString(),
          disputedTransactionId: event.gatewayTransactionId ?? null,
          disputedEventId: event.eventId,
        },
      });
    } catch (error) {
      this.logger.error('Failed to handle payment dispute', error);
      throw error;
    }
  }

  /**
   * Cancel subscription: calls payment gateway (scheduled mode — access is
   * retained until period end) then flags local DB intent. Called by
   * user-initiated cancel (DELETE /subscriptions/:id/cancel).
   *
   * Does NOT downgrade immediately and does NOT set `is_active: false`.
   * The downgrade happens only via the `subscription.expired` webhook
   * (`handleSubscriptionDeactivated`), once the paid-for period actually
   * ends.
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

    // Cancel at the gateway in scheduled mode (access retained until period end).
    // 4xx = subscription doesn't exist at gateway (record locally but log ERROR)
    // Network/5xx = transient — still record locally, ops can reconcile via webhook
    try {
      await this.paymentService.cancelSubscription({
        subscriptionId: subscription.payment_gateway_subscription_id,
      });
      this.logger.log(
        `Gateway cancellation (scheduled) confirmed for ${subscription.payment_gateway_subscription_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Gateway cancellation call failed for ${subscription.payment_gateway_subscription_id} — proceeding with ` +
          `local cancellation flag only. The local record now says "scheduled to cancel" but the gateway may not. ` +
          `MANUAL RECONCILIATION REQUIRED: confirm the gateway actually cancels it before the current period ends, ` +
          `or the customer keeps being billed after they asked to cancel.`,
        {
          error: error?.message,
          gatewaySubId: subscription.payment_gateway_subscription_id,
        },
      );
      // Intentionally not re-throwing: local DB update captures user intent.
    }

    const cancelled = await this.update(subscriptionId, {
      status: SubscriptionStatus.SCHEDULED_CANCEL,
      is_cancelled: true,
      cancelled_at: new Date(),
      // The user paid for this period — access is not revoked here.
      is_active: true,
    });

    this.logger.log(
      `Subscription ${subscriptionId} scheduled for cancellation by user ${userId}; access retained until period end`,
    );

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
   * Exhaustive event-type -> `user_subscriptions.status` map. `null` means
   * the event type carries no unambiguous status by itself (e.g. a generic
   * "updated" event, or a payment refund/dispute, which affects
   * `payment_history` but not subscription lifecycle on its own) — callers
   * must leave `status` untouched rather than guess.
   *
   * MUST NEVER be derived from `event.status`: that field is
   * `CREEM_STATUS_MAP[...]` with no fallback (see
   * `CreemSubscription`/`docs/superpowers/plans/...` "Carry-forward
   * constraints from Task 5"), so it is `undefined` for any Creem status
   * this codebase hasn't caught up to yet. Keying off `event.type` instead
   * means an unmapped Creem status can never silently revoke access.
   */
  private static readonly EVENT_TYPE_TO_SUBSCRIPTION_STATUS: Record<
    PaymentEventType,
    SubscriptionStatus | null
  > = {
    [PaymentEventType.SUBSCRIPTION_ACTIVATED]: SubscriptionStatus.ACTIVE,
    [PaymentEventType.SUBSCRIPTION_RENEWED]: SubscriptionStatus.ACTIVE,
    [PaymentEventType.SUBSCRIPTION_TRIALING]: SubscriptionStatus.ACTIVE,
    [PaymentEventType.SUBSCRIPTION_PAYMENT_FAILED]: SubscriptionStatus.PAST_DUE,
    [PaymentEventType.SUBSCRIPTION_CANCEL_SCHEDULED]:
      SubscriptionStatus.SCHEDULED_CANCEL,
    [PaymentEventType.SUBSCRIPTION_CANCELLED]: SubscriptionStatus.CANCELLED,
    [PaymentEventType.SUBSCRIPTION_EXPIRED]: SubscriptionStatus.EXPIRED,
    [PaymentEventType.SUBSCRIPTION_PAUSED]: SubscriptionStatus.PAUSED,
    [PaymentEventType.SUBSCRIPTION_UPDATED]: null,
    [PaymentEventType.PAYMENT_REFUNDED]: null,
    [PaymentEventType.PAYMENT_DISPUTED]: null,
    [PaymentEventType.UNKNOWN]: null,
  };

  /**
   * Exhaustive set of event types that mean "the user currently has paid
   * access". `is_active` must be derived ONLY from this set (keyed on
   * `event.type`), never from `event.status` — see the constraint above.
   *
   * `SUBSCRIPTION_CANCEL_SCHEDULED` is deliberately included: the user
   * already paid for the current period, so access is retained until
   * `subscription.expired` arrives.
   */
  private static readonly ACTIVATING_EVENT_TYPES: ReadonlySet<PaymentEventType> =
    new Set([
      PaymentEventType.SUBSCRIPTION_ACTIVATED,
      PaymentEventType.SUBSCRIPTION_RENEWED,
      PaymentEventType.SUBSCRIPTION_TRIALING,
      PaymentEventType.SUBSCRIPTION_CANCEL_SCHEDULED,
    ]);

  /**
   * Looks up the persisted-status map, normalizing its deliberate `null`
   * ("don't know / don't change") to `undefined` so the result can be
   * spread straight into `IUpdateSubscriptionData.status` (`SubscriptionStatus
   * | undefined`) without every caller re-checking for `null`.
   */
  private eventTypeToPersistedStatus(
    type: PaymentEventType,
  ): SubscriptionStatus | undefined {
    return (
      SubscriptionService.EVENT_TYPE_TO_SUBSCRIPTION_STATUS[type] ?? undefined
    );
  }

  /**
   * Defense-in-depth re-verification that the subscription identified by
   * `gatewaySubscriptionId` actually belongs to `resolvedUserId`, before a
   * caller is allowed to grant or revoke premium access for that id. Never
   * trusts the caller's own user resolution — always re-reads the row
   * fresh from the DB. Returns `false` (and logs at `error`) on any
   * mismatch or if the row can't be found, so callers fail closed.
   */
  private async verifySubscriptionOwnership(
    gatewaySubscriptionId: string | undefined,
    resolvedUserId: string,
    eventId: string,
  ): Promise<boolean> {
    if (!gatewaySubscriptionId) {
      this.logger.error(
        `Ownership check failed: no gatewaySubscriptionId to verify against for resolved user ${resolvedUserId} (event ${eventId})`,
      );
      return false;
    }

    const subscription = await this.findByExternalId(gatewaySubscriptionId);
    if (!subscription) {
      this.logger.error(
        `Ownership check failed: no subscription found for gatewaySubscriptionId ${gatewaySubscriptionId} (event ${eventId})`,
      );
      return false;
    }

    if (subscription.user_id !== resolvedUserId) {
      this.logger.error(
        `Ownership mismatch: resolved user ${resolvedUserId} does not own subscription ${subscription.id} ` +
          `(actual owner ${subscription.user_id}) for gatewaySubscriptionId ${gatewaySubscriptionId}, event ${eventId} — skipping plan change`,
      );
      return false;
    }

    return true;
  }

  /**
   * Process payment gateway events that create-or-refresh an active
   * subscription (routed here from `handleSuccessfulPayment`, i.e.
   * activated/renewed/trialing events).
   *
   * THE QUOTA FIX: when the subscription already exists, `starts_at`/
   * `ends_at` are refreshed from the event's period dates. Creem keeps ONE
   * subscription row across renewals (LemonSqueezy created a new row per
   * renewal) — without this refresh, `starts_at` stays pinned to the
   * original signup date and `ReplacementQuotaService.resolveMonthlyWindow`
   * (`replacement-quota.service.ts:203`) never resets the monthly
   * replacement quota for a paying customer.
   */
  async processPaymentGatewayEvent(
    event: NormalizedWebhookEvent,
    user?: User,
    plan?: SubscriptionPlan,
  ): Promise<IProcessPaymentGatewayEventResult> {
    try {
      this.logger.log(`Processing payment gateway event: ${event.type}`);

      const subscriptionExternalId = event.gatewaySubscriptionId;
      if (!subscriptionExternalId) {
        this.logger.warn(
          `Cannot process ${event.type}: no gatewaySubscriptionId on normalized event ${event.eventId} — skipping without mutating state`,
        );
        return {
          eventType: event.type,
          subscriptionCreated: false,
          subscription: null,
        };
      }

      // Idempotency: if subscription already exists, refresh it instead of
      // creating a duplicate.
      const existing = await this.findByExternalId(subscriptionExternalId);
      if (existing) {
        // Creem gives no delivery-ordering guarantee, and the transaction-id
        // dedup gate (payment_history) only stops replays of the SAME
        // transaction — two different, legitimately-signed events can still
        // arrive out of sequence. Without this guard, a stale "renewed"
        // event landing after a newer "cancelled"/"expired" event would
        // blindly flip status/is_active back to active, resurrecting
        // revoked access. `periodStart` not being newer than the row's
        // current `starts_at` is treated as staleness, independent of
        // event type, so it doesn't need to enumerate transitions.
        if (event.periodStart) {
          const isStale =
            event.periodStart.getTime() <= existing.starts_at.getTime();
          if (isStale) {
            this.logger.warn(
              `Stale/out-of-order event ${event.eventId} (${event.type}) for subscription ${subscriptionExternalId}: ` +
                `event.periodStart=${event.periodStart.toISOString()} is not newer than the stored ` +
                `starts_at=${existing.starts_at.toISOString()} — skipping without mutating state`,
            );
            return {
              eventType: event.type,
              subscriptionCreated: false,
              subscription: this.toSubscriptionSummary(existing),
            };
          }
        } else {
          this.logger.warn(
            `Event ${event.eventId} (${event.type}) for subscription ${subscriptionExternalId} has no periodStart — staleness check skipped`,
          );
        }

        this.logger.log(
          `Subscription ${subscriptionExternalId} already exists (${existing.id}), refreshing from event`,
        );

        const persistedStatus = this.eventTypeToPersistedStatus(event.type);
        // Only a genuine "the user paid and has access" event clears a
        // prior cancellation flag. `SUBSCRIPTION_CANCEL_SCHEDULED` is in
        // ACTIVATING_EVENT_TYPES (is_active stays true) but is NOT this —
        // it IS a cancellation, so gating on the persisted status (ACTIVE
        // only) rather than that set avoids ever clearing is_cancelled for
        // a cancel-scheduled event that happened to reach this branch.
        const isGenuineActivation =
          persistedStatus === SubscriptionStatus.ACTIVE;

        const updated = await this.update(existing.id, {
          status: persistedStatus,
          is_active: SubscriptionService.ACTIVATING_EVENT_TYPES.has(event.type),
          // Conditional spreads: periodStart/periodEnd are optional and
          // must NEVER be written as epoch or undefined (Task 5's
          // carry-forward constraint — epoch is a safe sentinel for a
          // non-persisted read model, not for this column).
          ...(event.periodStart ? { starts_at: event.periodStart } : {}),
          ...(event.periodEnd ? { ends_at: event.periodEnd } : {}),
          ...(event.gatewayCustomerId
            ? { payment_gateway_customer_id: event.gatewayCustomerId }
            : {}),
          // Consistency guard: a row with is_active=true and is_cancelled=
          // true simultaneously is incoherent regardless of how it got
          // there — clear the cancellation flag whenever a genuine
          // activation legitimately applies.
          ...(isGenuineActivation
            ? { is_cancelled: false, cancelled_at: null }
            : {}),
        });
        return {
          eventType: event.type,
          subscriptionCreated: false,
          subscription: this.toSubscriptionSummary(updated),
        };
      }

      if (!user || !plan) {
        this.logger.warn(
          `Cannot create subscription for ${subscriptionExternalId}: user or plan not resolved for event ${event.eventId}`,
        );
        return {
          eventType: event.type,
          subscriptionCreated: false,
          subscription: null,
        };
      }

      const subscription = await this.create(
        this.mapEventToCreateData(event, user, plan),
      );

      return {
        eventType: event.type,
        subscriptionCreated: true,
        subscription: this.toSubscriptionSummary(subscription),
      };
    } catch (error) {
      this.logger.error('Failed to process payment gateway event', error);
      throw error;
    }
  }

  private toSubscriptionSummary(
    subscription: UserSubscription,
  ): ISubscriptionSummary {
    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      isActive: subscription.is_active,
      userId: subscription.user_id,
      subscriptionPlanId: subscription.subscription_plan_id,
    };
  }

  /**
   * Maps a normalized webhook event to subscription-creation data.
   * Money (`amount`/`currency`) is sourced from the resolved
   * `subscription_plans` row, never the webhook payload — same rule Task 9
   * applies to `payment_history` (Creem's webhook objects don't reliably
   * carry price inline, and the plan is our own authoritative record).
   */
  private mapEventToCreateData(
    event: NormalizedWebhookEvent,
    user: User,
    plan: SubscriptionPlan,
  ): ICreateSubscriptionData {
    const now = new Date();
    // Fail loudly rather than default to ACTIVE. A brand-new subscription
    // is only ever created from a genuine "the user has access" event
    // (activated/renewed/trialing today); silently defaulting an
    // unrecognised event type to ACTIVE would grant access nobody decided
    // to grant, and contradicts this file's "never guess" rule everywhere
    // else. This is unreachable today (only handleSuccessfulPayment feeds
    // this path, and only with events that map to ACTIVE) — this guard is
    // for whoever wires a new caller in later.
    const status = this.eventTypeToPersistedStatus(event.type);
    if (!status) {
      throw new BadRequestException(
        `Cannot create a subscription from event type ${event.type} (event ${event.eventId}): ` +
          `it maps to no unambiguous status. This event type must not reach subscription creation.`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    return {
      payment_gateway_subscription_id: event.gatewaySubscriptionId,
      payment_gateway_customer_id: event.gatewayCustomerId,
      subscription_plan_id: plan.id,
      user_id: user.id,
      status,
      amount: plan.price,
      currency: plan.currency,
      starts_at: event.periodStart ?? now,
      ends_at:
        event.periodEnd ??
        new Date(now.getTime() + DEFAULT_SUBSCRIPTION_PERIOD_MS),
      metadata: {
        ...event.metadata,
        gatewayEventId: event.eventId,
        rawType: event.rawType,
      },
    };
  }

  //#endregion
}
