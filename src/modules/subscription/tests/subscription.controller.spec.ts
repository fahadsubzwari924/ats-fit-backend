/**
 * Controller-level tests for SubscriptionController.paymentConfirmation —
 * the Task 7 rewire that wires the (already hardened) verify -> parse ->
 * resolve -> claim -> route -> markAsProcessed pipeline together.
 *
 * This is controller wiring, not an integration test of the layers beneath
 * it: PaymentService, SubscriptionService, PaymentHistoryService,
 * SubscriptionPlanService, and UserService are all mocked. The goal is to
 * prove the ORCHESTRATION contract:
 *   - signature verification runs before any DB access, and a bad/missing
 *     signature never reaches a DB write;
 *   - entitlement resolves from metadata.user_id, never metadata.email;
 *   - the claim gate's 'duplicate' outcome skips the handler;
 *   - markAsProcessed only runs after a successful handler;
 *   - every rejection path returns an identical status/body (no oracle);
 *   - PAYMENT_DISPUTED and PAYMENT_REFUNDED are genuinely routed.
 */
import { ConfigService } from '@nestjs/config';
import { SubscriptionController } from '../controllers/subscription.controller';
import { PaymentService } from '../../../shared/services/payment.service';
import { SubscriptionService } from '../services/subscription.service';
import { PaymentHistoryService } from '../services/payment-history.service';
import { SubscriptionPlanService } from '../services/subscription-plan.service';
import { UserService } from '../../user/user.service';
import { PaymentEventType } from '../enums/payment-event-type.enum';
import { NormalizedWebhookEvent } from '../externals/interfaces/normalized-webhook-event.interface';
import { User } from '../../../database/entities/user.entity';
import { SubscriptionPlan } from '../../../database/entities/subscription-plan.entity';
import { PaymentHistory } from '../../../database/entities/payment-history.entity';
import { PaymentClaimResult } from '../interfaces/payment-claim-result.interface';
import { BadRequestException } from '../../../shared/exceptions/custom-http-exceptions';

describe('SubscriptionController.paymentConfirmation (controller wiring)', () => {
  let controller: SubscriptionController;

  let mockPaymentService: {
    verifyWebhookSignature: jest.Mock;
    parseWebhook: jest.Mock;
  };
  let mockSubscriptionService: {
    handleSuccessfulPayment: jest.Mock;
    handleFailedPayment: jest.Mock;
    handleCancellationScheduled: jest.Mock;
    handleSubscriptionDeactivated: jest.Mock;
    handleSubscriptionUpdated: jest.Mock;
    handlePaymentDisputed: jest.Mock;
  };
  let mockPaymentHistoryService: {
    claimPaymentEvent: jest.Mock;
    markAsProcessed: jest.Mock;
  };
  let mockSubscriptionPlanService: {
    findById: jest.Mock;
    findByProductId: jest.Mock;
  };
  let mockUserService: {
    getUserById: jest.Mock;
    getUserByEmail: jest.Mock;
  };
  let mockConfigService: {
    get: jest.Mock;
  };

  const testUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'owner@example.com',
  } as User;
  const otherUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'other@example.com',
  } as User;
  const testPlan = {
    id: 'plan-1',
    price: 12,
    currency: 'USD',
  } as unknown as SubscriptionPlan;

  const reservedRow = { id: 'history-row-1' } as PaymentHistory;
  const reservedClaim: PaymentClaimResult = {
    outcome: 'reserved',
    row: reservedRow,
  };
  const duplicateClaim: PaymentClaimResult = {
    outcome: 'duplicate',
    row: reservedRow,
  };

  const baseEvent = (
    overrides: Partial<NormalizedWebhookEvent> = {},
  ): NormalizedWebhookEvent => ({
    eventId: 'evt_1',
    type: PaymentEventType.SUBSCRIPTION_ACTIVATED,
    rawType: 'checkout.completed',
    gatewaySubscriptionId: 'sub_1',
    gatewayTransactionId: 'txn_1',
    gatewayProductId: 'prod_1',
    isTestMode: true,
    metadata: { user_id: testUser.id, plan_id: testPlan.id },
    customerEmail: testUser.email,
    raw: { note: 'test' },
    ...overrides,
  });

  /** Minimal RawBodyRequest<Request> double. `rawBody: undefined` simulates
   * the "no raw body available" case. */
  const buildReq = (rawBody: string | undefined) =>
    ({
      rawBody: rawBody === undefined ? undefined : Buffer.from(rawBody, 'utf8'),
    }) as any;

  const headers = { 'webhook-signature': 'v1,deadbeef' };

  beforeEach(() => {
    mockPaymentService = {
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
      parseWebhook: jest.fn().mockReturnValue(baseEvent()),
    };
    mockSubscriptionService = {
      handleSuccessfulPayment: jest.fn().mockResolvedValue(undefined),
      handleFailedPayment: jest.fn().mockResolvedValue(undefined),
      handleCancellationScheduled: jest.fn().mockResolvedValue(undefined),
      handleSubscriptionDeactivated: jest.fn().mockResolvedValue(undefined),
      handleSubscriptionUpdated: jest.fn().mockResolvedValue(undefined),
      handlePaymentDisputed: jest.fn().mockResolvedValue(undefined),
    };
    mockPaymentHistoryService = {
      claimPaymentEvent: jest.fn().mockResolvedValue(reservedClaim),
      markAsProcessed: jest.fn().mockResolvedValue(undefined),
    };
    mockSubscriptionPlanService = {
      findById: jest.fn().mockResolvedValue(testPlan),
      findByProductId: jest.fn().mockResolvedValue(testPlan),
    };
    mockUserService = {
      getUserById: jest.fn().mockResolvedValue(testUser),
      getUserByEmail: jest.fn().mockResolvedValue(testUser),
    };
    mockConfigService = {
      get: jest.fn(),
    };

    controller = new SubscriptionController(
      mockPaymentService as unknown as PaymentService,
      mockSubscriptionService as unknown as SubscriptionService,
      mockPaymentHistoryService as unknown as PaymentHistoryService,
      mockSubscriptionPlanService as unknown as SubscriptionPlanService,
      mockUserService as unknown as UserService,
      mockConfigService as unknown as ConfigService,
    );
  });

  // ---------------------------------------------------------------------
  // Happy path
  // ---------------------------------------------------------------------

  it('valid signature + valid payload -> routes to the handler and marks processed', async () => {
    await controller.paymentConfirmation(
      headers,
      { any: 'payload' },
      buildReq('{"any":"payload"}'),
    );

    expect(mockPaymentService.verifyWebhookSignature).toHaveBeenCalledWith(
      headers,
      '{"any":"payload"}',
    );
    expect(
      mockSubscriptionService.handleSuccessfulPayment,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: 'evt_1' }),
      testUser,
      testPlan,
    );
    expect(mockPaymentHistoryService.markAsProcessed).toHaveBeenCalledWith(
      reservedRow.id,
    );
  });

  // ---------------------------------------------------------------------
  // Signature / raw-body rejection — no DB writes, no oracle
  // ---------------------------------------------------------------------

  it('invalid signature -> 400, and no database write of any kind is attempted', async () => {
    mockPaymentService.verifyWebhookSignature.mockReturnValue(false);

    await expect(
      controller.paymentConfirmation(
        headers,
        { any: 'payload' },
        buildReq('{"any":"payload"}'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(mockPaymentService.parseWebhook).not.toHaveBeenCalled();
    expect(mockUserService.getUserById).not.toHaveBeenCalled();
    expect(mockUserService.getUserByEmail).not.toHaveBeenCalled();
    expect(mockSubscriptionPlanService.findById).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.claimPaymentEvent).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.markAsProcessed).not.toHaveBeenCalled();
  });

  it('missing req.rawBody -> rejected without any JSON.stringify fallback', async () => {
    await expect(
      controller.paymentConfirmation(
        headers,
        { any: 'payload' },
        buildReq(undefined),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // verifyWebhookSignature must never be reached with a re-serialised
    // JSON.stringify(payload) body — it must not be called at all here.
    expect(mockPaymentService.verifyWebhookSignature).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.claimPaymentEvent).not.toHaveBeenCalled();
  });

  it('all rejection paths return an identical status and body (no oracle)', async () => {
    let missingBodyError: any;
    try {
      await controller.paymentConfirmation(
        headers,
        { any: 'payload' },
        buildReq(undefined),
      );
    } catch (error) {
      missingBodyError = error;
    }

    mockPaymentService.verifyWebhookSignature.mockReturnValue(false);
    let badSignatureError: any;
    try {
      await controller.paymentConfirmation(
        headers,
        { any: 'payload' },
        buildReq('{"any":"payload"}'),
      );
    } catch (error) {
      badSignatureError = error;
    }

    expect(missingBodyError).toBeInstanceOf(BadRequestException);
    expect(badSignatureError).toBeInstanceOf(BadRequestException);
    expect(missingBodyError.getStatus()).toBe(badSignatureError.getStatus());
    expect(missingBodyError.getResponse()).toEqual(
      badSignatureError.getResponse(),
    );
  });

  // ---------------------------------------------------------------------
  // Claim gate
  // ---------------------------------------------------------------------

  it("outcome 'duplicate' -> handler is NOT run and 200 (no throw) is returned", async () => {
    mockPaymentHistoryService.claimPaymentEvent.mockResolvedValue(
      duplicateClaim,
    );

    await controller.paymentConfirmation(
      headers,
      { any: 'payload' },
      buildReq('{"any":"payload"}'),
    );

    expect(
      mockSubscriptionService.handleSuccessfulPayment,
    ).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.markAsProcessed).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Handler failure
  // ---------------------------------------------------------------------

  it('handler throws -> markAsProcessed is NOT called and the error propagates', async () => {
    const boom = new Error('SES is down');
    mockSubscriptionService.handleSuccessfulPayment.mockRejectedValue(boom);

    await expect(
      controller.paymentConfirmation(
        headers,
        { any: 'payload' },
        buildReq('{"any":"payload"}'),
      ),
    ).rejects.toBe(boom);

    expect(mockPaymentHistoryService.markAsProcessed).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Authorization fix: user_id over email
  // ---------------------------------------------------------------------

  it('resolves the user from metadata.user_id even when metadata.email names a different user', async () => {
    // metadata carries no `email` field read path in the controller at all,
    // but simulate the historical attack shape: customerEmail belongs to a
    // different account than metadata.user_id.
    mockPaymentService.parseWebhook.mockReturnValue(
      baseEvent({
        metadata: { user_id: testUser.id, plan_id: testPlan.id },
        customerEmail: otherUser.email,
      }),
    );

    await controller.paymentConfirmation(
      headers,
      { any: 'payload' },
      buildReq('{"any":"payload"}'),
    );

    expect(mockUserService.getUserById).toHaveBeenCalledWith(testUser.id);
    expect(mockUserService.getUserByEmail).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.claimPaymentEvent).toHaveBeenCalledWith(
      expect.anything(),
      testUser,
      testPlan,
    );
  });

  it('neither user_id nor customerEmail resolves -> 200, no payment_history insert', async () => {
    mockPaymentService.parseWebhook.mockReturnValue(
      baseEvent({ metadata: {}, customerEmail: undefined }),
    );

    await controller.paymentConfirmation(
      headers,
      { any: 'payload' },
      buildReq('{"any":"payload"}'),
    );

    expect(mockUserService.getUserById).not.toHaveBeenCalled();
    expect(mockUserService.getUserByEmail).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.claimPaymentEvent).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Malformed metadata.user_id — robustness fix
  //
  // `users.id` is a Postgres `uuid` column: a non-UUID `user_id` can never
  // resolve to a row, so it must never reach `getUserById` (which would
  // otherwise let the driver throw "invalid input syntax for type uuid"
  // and turn an unresolvable event into a 500 that Creem retries forever).
  // ---------------------------------------------------------------------

  it('malformed metadata.user_id ("x") does not throw and does not reach getUserById', async () => {
    mockPaymentService.parseWebhook.mockReturnValue(
      baseEvent({
        metadata: { user_id: 'x', plan_id: testPlan.id },
        customerEmail: undefined,
      }),
    );

    await expect(
      controller.paymentConfirmation(
        headers,
        { any: 'payload' },
        buildReq('{"any":"payload"}'),
      ),
    ).resolves.toBeUndefined();

    expect(mockUserService.getUserById).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.claimPaymentEvent).not.toHaveBeenCalled();
  });

  it('malformed metadata.user_id with a resolvable customerEmail falls back to the email path and entitles that user', async () => {
    mockPaymentService.parseWebhook.mockReturnValue(
      baseEvent({
        metadata: { user_id: 'x', plan_id: testPlan.id },
        customerEmail: testUser.email,
      }),
    );

    await controller.paymentConfirmation(
      headers,
      { any: 'payload' },
      buildReq('{"any":"payload"}'),
    );

    expect(mockUserService.getUserById).not.toHaveBeenCalled();
    expect(mockUserService.getUserByEmail).toHaveBeenCalledWith(testUser.email);
    expect(mockPaymentHistoryService.claimPaymentEvent).toHaveBeenCalledWith(
      expect.anything(),
      testUser,
      testPlan,
    );
  });

  it('valid-UUID-but-nonexistent user_id -> unchanged: log-only, 200, no payment_history insert', async () => {
    mockUserService.getUserById.mockResolvedValue(null);
    mockPaymentService.parseWebhook.mockReturnValue(
      baseEvent({
        metadata: {
          user_id: '00000000-0000-4000-8000-000000000000',
          plan_id: testPlan.id,
        },
        customerEmail: undefined,
      }),
    );

    await controller.paymentConfirmation(
      headers,
      { any: 'payload' },
      buildReq('{"any":"payload"}'),
    );

    expect(mockUserService.getUserById).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000000',
    );
    expect(mockUserService.getUserByEmail).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.claimPaymentEvent).not.toHaveBeenCalled();
  });

  it('a genuine repository failure on a validly-shaped user_id still surfaces (is not swallowed)', async () => {
    const connectionFailure = new Error('Connection terminated unexpectedly');
    mockUserService.getUserById.mockRejectedValue(connectionFailure);

    await expect(
      controller.paymentConfirmation(
        headers,
        { any: 'payload' },
        buildReq('{"any":"payload"}'),
      ),
    ).rejects.toBe(connectionFailure);

    expect(mockPaymentHistoryService.claimPaymentEvent).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.markAsProcessed).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------

  it('UNKNOWN event -> 200, no subscription state change', async () => {
    mockPaymentService.parseWebhook.mockReturnValue(
      baseEvent({ type: PaymentEventType.UNKNOWN, rawType: 'something.new' }),
    );

    await controller.paymentConfirmation(
      headers,
      { any: 'payload' },
      buildReq('{"any":"payload"}'),
    );

    expect(
      mockSubscriptionService.handleSuccessfulPayment,
    ).not.toHaveBeenCalled();
    expect(mockSubscriptionService.handleFailedPayment).not.toHaveBeenCalled();
    expect(
      mockSubscriptionService.handleSubscriptionDeactivated,
    ).not.toHaveBeenCalled();
    expect(
      mockSubscriptionService.handleSubscriptionUpdated,
    ).not.toHaveBeenCalled();
    expect(
      mockSubscriptionService.handlePaymentDisputed,
    ).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.markAsProcessed).toHaveBeenCalledWith(
      reservedRow.id,
    );
  });

  it('PAYMENT_DISPUTED reaches SubscriptionService.handlePaymentDisputed', async () => {
    mockPaymentService.parseWebhook.mockReturnValue(
      baseEvent({
        type: PaymentEventType.PAYMENT_DISPUTED,
        rawType: 'dispute.created',
      }),
    );

    await controller.paymentConfirmation(
      headers,
      { any: 'payload' },
      buildReq('{"any":"payload"}'),
    );

    expect(mockSubscriptionService.handlePaymentDisputed).toHaveBeenCalledWith(
      expect.objectContaining({ type: PaymentEventType.PAYMENT_DISPUTED }),
      testUser,
    );
    expect(mockPaymentHistoryService.markAsProcessed).toHaveBeenCalledWith(
      reservedRow.id,
    );
  });

  it('PAYMENT_REFUNDED is recorded (history-only) and marked processed without a handler call', async () => {
    mockPaymentService.parseWebhook.mockReturnValue(
      baseEvent({
        type: PaymentEventType.PAYMENT_REFUNDED,
        rawType: 'refund.created',
      }),
    );

    await controller.paymentConfirmation(
      headers,
      { any: 'payload' },
      buildReq('{"any":"payload"}'),
    );

    expect(
      mockSubscriptionService.handlePaymentDisputed,
    ).not.toHaveBeenCalled();
    expect(
      mockSubscriptionService.handleSuccessfulPayment,
    ).not.toHaveBeenCalled();
    expect(mockPaymentHistoryService.markAsProcessed).toHaveBeenCalledWith(
      reservedRow.id,
    );
  });
});
