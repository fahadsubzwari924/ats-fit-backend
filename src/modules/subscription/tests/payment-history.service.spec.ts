/**
 * Integration tests for PaymentHistoryService.claimPaymentEvent — the atomic
 * replay gate for the public payment webhook (Task 9 of the Creem migration).
 *
 * This deliberately runs against a REAL local Postgres rather than a mocked
 * repository: the whole point of the claim UPSERT is a single conditional
 * `INSERT ... ON CONFLICT ... WHERE ...` statement whose atomicity and
 * WHERE-clause staleness logic cannot be meaningfully verified against a
 * mock. The repo has no existing DB-backed test harness (all other specs
 * mock `getRepositoryToken`), so this spec builds its own `DataSource`
 * pointed at the local dev Postgres described in `src/config/.env.dev`
 * (`postgresql://postgres@localhost:5433/ats_fit`), matching
 * `src/database/data-source.ts`'s connection shape.
 *
 * Requires the migrated local Postgres described in the task brief. If it is
 * unreachable, every test in this file fails at `beforeAll` with a clear
 * connection error rather than silently skipping.
 */
import { DataSource, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PaymentHistoryService } from '../services/payment-history.service';
import { PaymentHistory } from '../../../database/entities/payment-history.entity';
import { SubscriptionPlan } from '../../../database/entities/subscription-plan.entity';
import { User } from '../../../database/entities/user.entity';
import { PaymentEventType } from '../enums/payment-event-type.enum';
import { PaymentStatus } from '../enums/payment.enum';
import { NormalizedWebhookEvent } from '../externals/interfaces/normalized-webhook-event.interface';
import { SubscriptionStatus } from '../enums/subscription-status.enum';

describe('PaymentHistoryService (integration, live Postgres)', () => {
  let dataSource: DataSource;
  let paymentHistoryRepo: Repository<PaymentHistory>;
  let service: PaymentHistoryService;

  let testUser: User;
  let testPlan: SubscriptionPlan;

  const createdTransactionIds: string[] = [];

  const baseEvent = (
    overrides: Partial<NormalizedWebhookEvent> = {},
  ): NormalizedWebhookEvent => {
    const gatewayTransactionId = `test-txn-${randomUUID()}`;
    createdTransactionIds.push(gatewayTransactionId);
    return {
      eventId: `evt_${randomUUID()}`,
      type: PaymentEventType.SUBSCRIPTION_ACTIVATED,
      rawType: 'subscription.active',
      gatewayTransactionId,
      gatewayProductId: testPlan?.payment_gateway_product_id,
      isTestMode: true,
      metadata: {},
      raw: { note: 'test event' },
      customerEmail: testUser?.email,
      ...overrides,
    };
  };

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: 'localhost',
      port: 5433,
      username: 'postgres',
      password: 'Jumpshare__1',
      database: 'ats_fit',
      // Load every entity (not just the three this spec touches) — several
      // carry relation decorators (e.g. SubscriptionPlan -> UserSubscription)
      // that TypeORM's metadata builder needs resolvable even when unused.
      entities: [__dirname + '/../../../database/entities/*.entity.{js,ts}'],
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();

    paymentHistoryRepo = dataSource.getRepository(PaymentHistory);
    service = new PaymentHistoryService(paymentHistoryRepo);

    const userRepo = dataSource.getRepository(User);
    const planRepo = dataSource.getRepository(SubscriptionPlan);

    testUser = await userRepo.save(
      userRepo.create({
        full_name: 'Payment History Test User',
        email: `payment-history-test-${randomUUID()}@example.com`,
        password: 'not-a-real-hash',
      }),
    );

    testPlan = await planRepo.save(
      planRepo.create({
        plan_name: 'Payment History Test Plan',
        description: 'Created by payment-history.service.spec.ts',
        price: 12.34,
        currency: 'USD',
        payment_gateway_product_id: `prod_test_${randomUUID()}`,
        is_active: true,
      }),
    );
  });

  afterAll(async () => {
    // Best-effort cleanup — remove any rows this spec created.
    if (createdTransactionIds.length > 0) {
      await paymentHistoryRepo
        .createQueryBuilder()
        .delete()
        .where('payment_gateway_transaction_id IN (:...ids)', {
          ids: createdTransactionIds,
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
    await dataSource.destroy();
  });

  it('claims a fresh event and returns a proceed outcome', async () => {
    const event = baseEvent();

    const result = await service.claimPaymentEvent(event, testUser, testPlan);

    expect(result.outcome).toBe('reserved');
    expect(result.row.payment_gateway_transaction_id).toBe(
      event.gatewayTransactionId,
    );
    expect(result.row.processed_at).toBeNull();
  });

  it('closes the proven race: a second delivery while processed_at IS NULL and a fresh claim exists is NOT claimed', async () => {
    const event = baseEvent();

    const first = await service.claimPaymentEvent(event, testUser, testPlan);
    expect(first.outcome).toBe('reserved');

    // Simulate a concurrent/near-simultaneous retry of the SAME transaction
    // id, arriving before the first handler has finished (processed_at is
    // still NULL) and before the claim has gone stale. Under the old
    // "INSERT ... ON CONFLICT DO NOTHING" design this returned 0 rows but
    // the caller still read processed_at IS NULL and proceeded — the proven
    // double-processing race. The new claim UPSERT must refuse this instead.
    const second = await service.claimPaymentEvent(event, testUser, testPlan);

    expect(second.outcome).toBe('duplicate');
    expect(second.row.id).toBe(first.row.id);

    // The row was not mutated by the rejected second attempt.
    const stored = await paymentHistoryRepo.findOne({
      where: { id: first.row.id },
    });
    expect(stored?.processed_at).toBeNull();
  });

  it('a second delivery after processed_at is set is treated as a duplicate', async () => {
    const event = baseEvent();

    const first = await service.claimPaymentEvent(event, testUser, testPlan);
    expect(first.outcome).toBe('reserved');

    await service.markAsProcessed(first.row.id);

    const second = await service.claimPaymentEvent(event, testUser, testPlan);

    expect(second.outcome).toBe('duplicate');
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.processed_at).not.toBeNull();
  });

  it('reclaims a stale claim (older than 2 minutes) as a retry', async () => {
    const event = baseEvent();

    const first = await service.claimPaymentEvent(event, testUser, testPlan);
    expect(first.outcome).toBe('reserved');

    // Backdate the claim past the 2-minute staleness window, simulating a
    // handler that crashed mid-flight and never called markAsProcessed.
    await paymentHistoryRepo.query(
      `UPDATE payment_history SET processing_claimed_at = now() - interval '3 minutes' WHERE id = $1`,
      [first.row.id],
    );

    const retry = await service.claimPaymentEvent(event, testUser, testPlan);

    expect(retry.outcome).toBe('retry');
    expect(retry.row.id).toBe(first.row.id);
  });

  it('sources amount/currency from the resolved plan row, not the event', async () => {
    const event = baseEvent({
      // NormalizedWebhookEvent.amountCents/currency are intentionally never
      // populated by the parser (Task 6) — but even if a caller somehow set
      // them, they must be ignored here.
      amountCents: 999999,
    });

    const result = await service.claimPaymentEvent(event, testUser, testPlan);

    expect(Number(result.row.amount)).toBe(Number(testPlan.price));
    expect(result.row.currency).toBe(testPlan.currency);
  });

  it('records amount 0 and a default currency when the plan is null', async () => {
    const event = baseEvent();

    const result = await service.claimPaymentEvent(event, testUser, null);

    expect(Number(result.row.amount)).toBe(0);
    expect(result.row.currency).toBe('USD');
    expect(result.row.subscription_plan_id).toBeNull();
  });

  it('sets status explicitly from event.type and never leaves it at pending', async () => {
    const activated = await service.claimPaymentEvent(
      baseEvent({ type: PaymentEventType.SUBSCRIPTION_ACTIVATED }),
      testUser,
      testPlan,
    );
    expect(activated.row.status).toBe(PaymentStatus.SUCCESS);
    expect(activated.row.status).not.toBe(PaymentStatus.PENDING);

    const failed = await service.claimPaymentEvent(
      baseEvent({ type: PaymentEventType.SUBSCRIPTION_PAYMENT_FAILED }),
      testUser,
      testPlan,
    );
    expect(failed.row.status).toBe(PaymentStatus.FAILED);

    const cancelled = await service.claimPaymentEvent(
      baseEvent({ type: PaymentEventType.SUBSCRIPTION_CANCELLED }),
      testUser,
      testPlan,
    );
    expect(cancelled.row.status).toBe(PaymentStatus.CANCELLED);
  });

  it('never derives status from event.status (advisory, may be undefined/misleading)', async () => {
    const event = baseEvent({
      type: PaymentEventType.SUBSCRIPTION_ACTIVATED,
      // Deliberately conflicting: if the implementation ever reads
      // event.status instead of event.type, this would push the row toward
      // CANCELLED/EXPIRED instead of SUCCESS.
      status: SubscriptionStatus.CANCELLED,
    });

    const result = await service.claimPaymentEvent(event, testUser, testPlan);

    expect(result.row.status).toBe(PaymentStatus.SUCCESS);
  });

  it('sets payment_gateway_transaction_id from event.gatewayTransactionId', async () => {
    const event = baseEvent();

    const result = await service.claimPaymentEvent(event, testUser, testPlan);

    expect(result.row.payment_gateway_transaction_id).toBe(
      event.gatewayTransactionId,
    );
  });

  it('rejects an event with no gatewayTransactionId', async () => {
    const event = baseEvent({ gatewayTransactionId: undefined });
    // Remove it from cleanup tracking — no row will ever be created for it.
    createdTransactionIds.pop();

    await expect(
      service.claimPaymentEvent(event, testUser, testPlan),
    ).rejects.toThrow();
  });

  describe('customer PII redaction in payment_gateway_response', () => {
    it('drops customer.email/name/metadata but keeps customer.id/country/mode', async () => {
      const rawPayload = {
        id: 'evt_redact_1',
        eventType: 'subscription.active',
        object: {
          id: 'sub_1',
          customer: {
            id: 'cust_123',
            email: 'contact@example.com',
            name: 'Jane Doe',
            country: 'US',
            mode: 'prod',
            metadata: { crmId: 'abc-999' },
          },
        },
      };

      const event = baseEvent({ raw: rawPayload });
      const result = await service.claimPaymentEvent(event, testUser, testPlan);

      const persisted = result.row.payment_gateway_response as any;
      const customer = persisted.object.customer;

      expect(customer.email).toBeUndefined();
      expect(customer.name).toBeUndefined();
      expect(customer.metadata).toBeUndefined();
      expect(customer.id).toBe('cust_123');
      expect(customer.country).toBe('US');
      expect(customer.mode).toBe('prod');
    });

    it('redacts a customer object nested under object.subscription (refund/dispute shape)', async () => {
      const rawPayload = {
        id: 'evt_redact_2',
        eventType: 'refund.created',
        object: {
          id: 'refund_1',
          transaction: { id: 'txn_1' },
          subscription: {
            id: 'sub_2',
            customer: {
              id: 'cust_456',
              email: 'nested@example.com',
              name: 'Nested Customer',
              country: 'DE',
              mode: 'prod',
              metadata: { note: 'should be dropped' },
            },
          },
        },
      };

      const event = baseEvent({ raw: rawPayload });
      const result = await service.claimPaymentEvent(event, testUser, testPlan);

      const persisted = result.row.payment_gateway_response as any;
      const nestedCustomer = persisted.object.subscription.customer;

      expect(nestedCustomer.email).toBeUndefined();
      expect(nestedCustomer.name).toBeUndefined();
      expect(nestedCustomer.metadata).toBeUndefined();
      expect(nestedCustomer.id).toBe('cust_456');
      expect(nestedCustomer.country).toBe('DE');
    });

    it('does not mutate event.raw while redacting', async () => {
      const rawPayload = {
        id: 'evt_redact_3',
        eventType: 'subscription.active',
        object: {
          id: 'sub_3',
          customer: {
            id: 'cust_789',
            email: 'untouched@example.com',
            name: 'Untouched Person',
            country: 'FR',
            mode: 'prod',
          },
        },
      };

      const event = baseEvent({ raw: rawPayload });
      await service.claimPaymentEvent(event, testUser, testPlan);

      // The original object passed in as event.raw must be unchanged — the
      // parser is pure and other code may still read this same reference.
      expect((rawPayload.object.customer as any).email).toBe(
        'untouched@example.com',
      );
      expect((rawPayload.object.customer as any).name).toBe('Untouched Person');
      expect(event.raw).toBe(rawPayload);
    });

    it('still populates the dedicated customer_email column unaffected by jsonb redaction', async () => {
      const rawPayload = {
        id: 'evt_redact_4',
        eventType: 'subscription.active',
        object: {
          id: 'sub_4',
          customer: {
            id: 'cust_321',
            email: 'column-check@example.com',
            name: 'Column Check',
          },
        },
      };

      const event = baseEvent({
        raw: rawPayload,
        customerEmail: 'column-check@example.com',
      });
      const result = await service.claimPaymentEvent(event, testUser, testPlan);

      expect(result.row.customer_email).toBe('column-check@example.com');
      const persisted = result.row.payment_gateway_response as any;
      expect(persisted.object.customer.email).toBeUndefined();
    });

    it('never persists a null or invalid payment_gateway_response, even for a minimal payload', async () => {
      const event = baseEvent({
        raw: { id: 'evt_redact_5', note: 'no customer key at all' },
      });

      const result = await service.claimPaymentEvent(event, testUser, testPlan);

      expect(result.row.payment_gateway_response).not.toBeNull();
      expect(typeof result.row.payment_gateway_response).toBe('object');

      // Confirm it round-trips through Postgres as valid jsonb by reading it
      // back directly, independent of the ORM's in-memory result.
      const rows = await paymentHistoryRepo.query(
        `SELECT payment_gateway_response FROM payment_history WHERE id = $1`,
        [result.row.id],
      );
      expect(rows[0].payment_gateway_response).not.toBeNull();
      expect(rows[0].payment_gateway_response.id).toBe('evt_redact_5');
    });
  });
});
