/**
 * Integration tests for SubscriptionService's normalized-webhook handlers
 * (Task 8 of the Creem migration).
 *
 * Runs against a REAL local Postgres, matching the pattern established by
 * `payment-history.service.spec.ts` (Task 9) — the whole point of this task
 * is state persisted into `user_subscriptions`, which a mocked repository
 * cannot meaningfully verify (in particular the conditional-spread rule for
 * `starts_at`/`ends_at`, and the Postgres `scheduled_cancel` enum value).
 * Requires the migrated local Postgres described in the task brief
 * (`postgresql://postgres@localhost:5433/ats_fit`). If unreachable, every
 * test here fails at `beforeAll` with a clear connection error.
 *
 * Peripheral collaborators (ConfigService, IEmailService, UserService,
 * PaymentService) are mocked — this suite is about persisted subscription
 * state, not email delivery or the gateway SDK.
 */
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { SubscriptionService } from '../services/subscription.service';
import { UserSubscription } from '../../../database/entities/user-subscription.entity';
import { SubscriptionPlan } from '../../../database/entities/subscription-plan.entity';
import { User } from '../../../database/entities/user.entity';
import { PaymentEventType } from '../enums/payment-event-type.enum';
import { SubscriptionStatus } from '../enums/subscription-status.enum';
import { NormalizedWebhookEvent } from '../externals/interfaces/normalized-webhook-event.interface';
import { ForbiddenException } from '../../../shared/exceptions/custom-http-exceptions';

describe('SubscriptionService (integration, live Postgres)', () => {
  let dataSource: DataSource;
  let userSubscriptionRepo: Repository<UserSubscription>;
  let service: SubscriptionService;

  let testUser: User;
  /** A second, unrelated user — used only for ownership-mismatch tests. */
  let otherUser: User;
  let testPlan: SubscriptionPlan;

  let mockUserService: {
    upgradeToPremium: jest.Mock;
    downgradeToFreemium: jest.Mock;
  };
  let mockPaymentService: { cancelSubscription: jest.Mock };
  let mockEmailService: { sendEmail: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  const createdSubscriptionIds: string[] = [];

  const baseEvent = (
    overrides: Partial<NormalizedWebhookEvent> = {},
  ): NormalizedWebhookEvent => ({
    eventId: `evt_${randomUUID()}`,
    type: PaymentEventType.SUBSCRIPTION_RENEWED,
    rawType: 'subscription.paid',
    gatewayTransactionId: `test-txn-${randomUUID()}`,
    gatewayProductId: testPlan?.payment_gateway_product_id,
    isTestMode: true,
    metadata: {},
    raw: { note: 'test event' },
    customerEmail: testUser?.email,
    ...overrides,
  });

  /** Inserts a pre-existing subscription row directly via the repo,
   * simulating "the subscription already exists" (Creem's one-row-forever
   * model). Returns the saved row. */
  const createExistingSubscription = async (
    overrides: Partial<UserSubscription> = {},
  ): Promise<UserSubscription> => {
    const gatewaySubscriptionId = `test-sub-${randomUUID()}`;
    createdSubscriptionIds.push(gatewaySubscriptionId);

    const original = new Date('2020-01-01T00:00:00.000Z');
    const originalEnds = new Date('2020-02-01T00:00:00.000Z');

    const subscription = userSubscriptionRepo.create({
      payment_gateway_subscription_id: gatewaySubscriptionId,
      subscription_plan_id: testPlan.id,
      user_id: testUser.id,
      status: SubscriptionStatus.ACTIVE,
      amount: testPlan.price,
      currency: testPlan.currency,
      starts_at: original,
      ends_at: originalEnds,
      is_active: true,
      is_cancelled: false,
      ...overrides,
    });

    return userSubscriptionRepo.save(subscription);
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: 'localhost',
      port: 5433,
      username: 'postgres',
      password: 'Jumpshare__1',
      database: 'ats_fit',
      entities: [__dirname + '/../../../database/entities/*.entity.{js,ts}'],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();

    userSubscriptionRepo = dataSource.getRepository(UserSubscription);

    const userRepo = dataSource.getRepository(User);
    const planRepo = dataSource.getRepository(SubscriptionPlan);

    testUser = await userRepo.save(
      userRepo.create({
        full_name: 'Subscription Service Test User',
        email: `subscription-service-test-${randomUUID()}@example.com`,
        password: 'not-a-real-hash',
      }),
    );

    otherUser = await userRepo.save(
      userRepo.create({
        full_name: 'Subscription Service Other User',
        email: `subscription-service-other-${randomUUID()}@example.com`,
        password: 'not-a-real-hash',
      }),
    );

    testPlan = await planRepo.save(
      planRepo.create({
        plan_name: 'Subscription Service Test Plan',
        description: 'Created by subscription.service.spec.ts',
        price: 19.99,
        currency: 'USD',
        payment_gateway_product_id: `prod_test_${randomUUID()}`,
        is_active: true,
      }),
    );
  });

  afterAll(async () => {
    if (createdSubscriptionIds.length > 0) {
      await userSubscriptionRepo
        .createQueryBuilder()
        .delete()
        .where('payment_gateway_subscription_id IN (:...ids)', {
          ids: createdSubscriptionIds,
        })
        .execute();
    }
    if (testPlan) {
      await dataSource
        .getRepository(SubscriptionPlan)
        .delete({ id: testPlan.id });
    }
    if (testUser) {
      await dataSource.getRepository(User).delete({ id: testUser.id });
    }
    if (otherUser) {
      await dataSource.getRepository(User).delete({ id: otherUser.id });
    }
    await dataSource.destroy();
  });

  beforeEach(() => {
    mockUserService = {
      upgradeToPremium: jest.fn().mockResolvedValue(undefined),
      downgradeToFreemium: jest.fn().mockResolvedValue(undefined),
    };
    mockPaymentService = {
      cancelSubscription: jest.fn().mockResolvedValue({
        subscriptionId: 'gateway-sub',
        status: SubscriptionStatus.ACTIVE,
        cancelledAt: new Date(),
      }),
    };
    mockEmailService = { sendEmail: jest.fn().mockResolvedValue(undefined) };
    mockConfigService = { get: jest.fn().mockReturnValue(undefined) };

    service = new SubscriptionService(
      userSubscriptionRepo,
      mockConfigService as any,
      mockEmailService as any,
      mockUserService as any,
      mockPaymentService as any,
    );
  });

  describe('processPaymentGatewayEvent — the quota fix', () => {
    it('SUBSCRIPTION_RENEWED on an existing subscription refreshes starts_at/ends_at', async () => {
      const existing = await createExistingSubscription();
      const newPeriodStart = new Date('2024-06-01T00:00:00.000Z');
      const newPeriodEnd = new Date('2024-07-01T00:00:00.000Z');

      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_RENEWED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
        periodStart: newPeriodStart,
        periodEnd: newPeriodEnd,
      });

      const result = await service.processPaymentGatewayEvent(event);

      expect(result.subscriptionCreated).toBe(false);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      expect(reloaded?.starts_at.toISOString()).toBe(
        newPeriodStart.toISOString(),
      );
      expect(reloaded?.ends_at.toISOString()).toBe(newPeriodEnd.toISOString());
      expect(reloaded?.is_active).toBe(true);
    });

    it('does not overwrite existing dates, and never writes epoch, when periodStart/periodEnd are undefined', async () => {
      const originalStarts = new Date('2021-03-01T00:00:00.000Z');
      const originalEnds = new Date('2021-04-01T00:00:00.000Z');
      const existing = await createExistingSubscription({
        starts_at: originalStarts,
        ends_at: originalEnds,
      });

      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_RENEWED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
        periodStart: undefined,
        periodEnd: undefined,
      });

      await service.processPaymentGatewayEvent(event);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      expect(reloaded?.starts_at.toISOString()).toBe(
        originalStarts.toISOString(),
      );
      expect(reloaded?.ends_at.toISOString()).toBe(originalEnds.toISOString());
      // Never epoch.
      expect(reloaded?.starts_at.getTime()).not.toBe(0);
      expect(reloaded?.ends_at.getTime()).not.toBe(0);
    });

    it('never derives is_active from event.status — an unmapped/undefined Creem status on SUBSCRIPTION_RENEWED still yields is_active: true', async () => {
      const existing = await createExistingSubscription({
        is_active: true,
      });

      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_RENEWED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
        status: undefined, // simulates an unmapped Creem status
      });

      await service.processPaymentGatewayEvent(event);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      expect(reloaded?.is_active).toBe(true);
    });

    it('an event with no gatewaySubscriptionId is a safe no-op', async () => {
      const existing = await createExistingSubscription();

      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_RENEWED,
        gatewaySubscriptionId: undefined,
      });

      const result = await service.processPaymentGatewayEvent(event);

      expect(result.subscriptionCreated).toBe(false);
      expect(result.subscription).toBeNull();

      // Nothing was mutated.
      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      expect(reloaded?.starts_at.toISOString()).toBe(
        existing.starts_at.toISOString(),
      );
    });
  });

  describe('handleCancellationScheduled', () => {
    it('leaves is_active true and does not downgrade', async () => {
      const existing = await createExistingSubscription();

      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_CANCEL_SCHEDULED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
      });

      await service.handleCancellationScheduled(event, testUser);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      expect(reloaded?.is_active).toBe(true);
      expect(reloaded?.is_cancelled).toBe(true);
      expect(reloaded?.status).toBe(SubscriptionStatus.SCHEDULED_CANCEL);
      expect(mockUserService.downgradeToFreemium).not.toHaveBeenCalled();
    });
  });

  describe('handleSubscriptionDeactivated', () => {
    it('SUBSCRIPTION_EXPIRED sets is_active false and downgrades', async () => {
      const existing = await createExistingSubscription({
        is_cancelled: true,
        status: SubscriptionStatus.SCHEDULED_CANCEL,
      });

      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_EXPIRED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
      });

      await service.handleSubscriptionDeactivated(event, testUser);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      expect(reloaded?.is_active).toBe(false);
      expect(reloaded?.status).toBe(SubscriptionStatus.EXPIRED);
      expect(mockUserService.downgradeToFreemium).toHaveBeenCalledWith(
        testUser.id,
      );
    });

    it('an event with no gatewaySubscriptionId is a safe no-op', async () => {
      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_EXPIRED,
        gatewaySubscriptionId: undefined,
      });

      await service.handleSubscriptionDeactivated(event, testUser);

      expect(mockUserService.downgradeToFreemium).not.toHaveBeenCalled();
    });
  });

  describe('cancelUserSubscription', () => {
    it('keeps is_active true and does not downgrade', async () => {
      const existing = await createExistingSubscription();

      const cancelled = await service.cancelUserSubscription(
        existing.id,
        testUser.id,
      );

      expect(cancelled.is_active).toBe(true);
      expect(cancelled.is_cancelled).toBe(true);
      expect(cancelled.status).toBe(SubscriptionStatus.SCHEDULED_CANCEL);
      expect(mockUserService.downgradeToFreemium).not.toHaveBeenCalled();
      expect(mockPaymentService.cancelSubscription).toHaveBeenCalledWith({
        subscriptionId: existing.payment_gateway_subscription_id,
      });
    });

    it('still flags local cancellation intent when the gateway call fails, without re-throwing', async () => {
      mockPaymentService.cancelSubscription.mockRejectedValue(
        new Error('gateway unreachable'),
      );
      const existing = await createExistingSubscription();

      const cancelled = await service.cancelUserSubscription(
        existing.id,
        testUser.id,
      );

      expect(cancelled.is_active).toBe(true);
      expect(cancelled.status).toBe(SubscriptionStatus.SCHEDULED_CANCEL);
    });
  });

  describe('out-of-order delivery (security review finding 1)', () => {
    it('a stale RENEWED arriving after cancellation does NOT resurrect access', async () => {
      // Row is already cancelled, with a period that started 2024-06-01.
      const existing = await createExistingSubscription({
        starts_at: new Date('2024-06-01T00:00:00.000Z'),
        ends_at: new Date('2024-07-01T00:00:00.000Z'),
        status: SubscriptionStatus.CANCELLED,
        is_active: false,
        is_cancelled: true,
      });

      // A legitimately-signed but LATE renewal for an OLDER period.
      const staleEvent = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_RENEWED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
        periodStart: new Date('2024-05-01T00:00:00.000Z'),
        periodEnd: new Date('2024-06-01T00:00:00.000Z'),
      });

      await service.processPaymentGatewayEvent(staleEvent);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      // Access must NOT be restored.
      expect(reloaded?.is_active).toBe(false);
      expect(reloaded?.status).toBe(SubscriptionStatus.CANCELLED);
      // And the period must not have been dragged backwards.
      expect(reloaded?.starts_at.toISOString()).toBe(
        '2024-06-01T00:00:00.000Z',
      );
    });

    it('a genuinely newer RENEWED does apply, and clears the stale is_cancelled flag', async () => {
      const existing = await createExistingSubscription({
        starts_at: new Date('2024-06-01T00:00:00.000Z'),
        ends_at: new Date('2024-07-01T00:00:00.000Z'),
        is_cancelled: true,
        status: SubscriptionStatus.SCHEDULED_CANCEL,
      });

      const freshEvent = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_RENEWED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
        periodStart: new Date('2024-07-01T00:00:00.000Z'),
        periodEnd: new Date('2024-08-01T00:00:00.000Z'),
      });

      await service.processPaymentGatewayEvent(freshEvent);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      expect(reloaded?.is_active).toBe(true);
      expect(reloaded?.status).toBe(SubscriptionStatus.ACTIVE);
      // is_active:true alongside is_cancelled:true would be an incoherent row.
      expect(reloaded?.is_cancelled).toBe(false);
    });
  });

  describe('ownership guard (security review finding 2)', () => {
    it('does not downgrade a user who does not own the subscription', async () => {
      const existing = await createExistingSubscription(); // owned by testUser

      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_EXPIRED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
      });

      // Caller mis-resolves the user (email collision / stale metadata).
      await service.handleSubscriptionDeactivated(event, otherUser);

      expect(mockUserService.downgradeToFreemium).not.toHaveBeenCalledWith(
        otherUser.id,
      );
    });

    it('cancelUserSubscription rejects a non-owner with ForbiddenException', async () => {
      const existing = await createExistingSubscription(); // owned by testUser

      await expect(
        service.cancelUserSubscription(existing.id, otherUser.id),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockPaymentService.cancelSubscription).not.toHaveBeenCalled();
    });
  });

  describe('handleSubscriptionUpdated', () => {
    it('leaves status/is_active untouched for a null-mapped event type, and MERGES metadata', async () => {
      const existing = await createExistingSubscription({
        metadata: { keepMe: 'original', gatewayEventId: 'evt_old' },
      });

      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_UPDATED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
        metadata: { addedByUpdate: 'yes' },
      });

      await service.handleSubscriptionUpdated(event);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      // SUBSCRIPTION_UPDATED maps to null — must not guess a status.
      expect(reloaded?.status).toBe(SubscriptionStatus.ACTIVE);
      expect(reloaded?.is_active).toBe(true);
      // Merge, not clobber.
      expect(reloaded?.metadata?.keepMe).toBe('original');
      expect(reloaded?.metadata?.gatewayEventId).toBe('evt_old');
      expect(reloaded?.metadata?.addedByUpdate).toBe('yes');
    });
  });

  describe('handleSubscriptionDeactivated — immediate cancellation branch', () => {
    it('SUBSCRIPTION_CANCELLED deactivates, flags is_cancelled, and downgrades', async () => {
      const existing = await createExistingSubscription();

      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_CANCELLED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
      });

      await service.handleSubscriptionDeactivated(event, testUser);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      expect(reloaded?.is_active).toBe(false);
      expect(reloaded?.status).toBe(SubscriptionStatus.CANCELLED);
      expect(reloaded?.is_cancelled).toBe(true);
      expect(mockUserService.downgradeToFreemium).toHaveBeenCalledWith(
        testUser.id,
      );
    });

    it('event.type wins over a CONFLICTING event.status claiming the sub is active', async () => {
      const existing = await createExistingSubscription();

      // The dangerous direction: a stale/contradictory advisory status that,
      // if trusted, would keep a lapsed subscriber's access alive.
      const event = baseEvent({
        type: PaymentEventType.SUBSCRIPTION_EXPIRED,
        gatewaySubscriptionId: existing.payment_gateway_subscription_id,
        status: SubscriptionStatus.ACTIVE,
      });

      await service.handleSubscriptionDeactivated(event, testUser);

      const reloaded = await userSubscriptionRepo.findOne({
        where: { id: existing.id },
      });
      expect(reloaded?.is_active).toBe(false);
      expect(reloaded?.status).toBe(SubscriptionStatus.EXPIRED);
    });
  });
});
