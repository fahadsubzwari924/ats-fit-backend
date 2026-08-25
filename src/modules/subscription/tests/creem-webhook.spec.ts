import * as crypto from 'node:crypto';
import { Logger } from '@nestjs/common';
import { CreemWebhookVerifier } from '../externals/webhooks/creem-webhook-verifier';
import { CreemWebhookParser } from '../externals/webhooks/creem-webhook-parser';
import { WebhookHeaders } from '../externals/interfaces/payment-gateway.interface';
import { PaymentEventType } from '../enums/payment-event-type.enum';
import { SubscriptionStatus } from '../enums/subscription-status.enum';

/**
 * Task 6 — webhook verification and parsing.
 *
 * Single spec file (not split verifier/parser) because the two units are
 * small, share no setup complexity that would justify separate files, and
 * this repo's existing precedent (`payment-abstraction.spec.ts`) keeps
 * closely-related payment-layer behavior in one file.
 *
 * Fixture discipline: every raw body used for signing is produced by
 * `JSON.stringify`-ing a fixture object EXACTLY ONCE and reusing that exact
 * string both to compute the test signature and as the parser input.
 * Re-serializing mid-test would drift on key order/whitespace and produce
 * spurious signature mismatches unrelated to the code under test.
 */

const SECRET_WITH_PREFIX = 'whsec_dGVzdC1zaWduaW5nLXNlY3JldC1iYXNlNjQ=';
const LEGACY_SECRET = 'legacy-plaintext-secret';

/**
 * Independently reproduces the standard-webhook signing algorithm for test
 * fixtures. Canonicalizes the timestamp via `Number.parseInt` before signing
 * — matching the authoritative algorithm (`webhooks.js:113-117`) and this
 * repo's implementation, which signs the PARSED timestamp, not the raw
 * header string. For any already-canonical timestamp this is a no-op.
 */
function signStandard(
  id: string,
  timestamp: string,
  rawBody: string,
  secret: string,
): string {
  const stripped = secret.startsWith('whsec_')
    ? secret.slice('whsec_'.length)
    : secret;
  const key = Buffer.from(stripped, 'base64');
  const canonicalTimestamp = Number.parseInt(timestamp, 10);
  const digest = crypto
    .createHmac('sha256', key)
    .update(`${id}.${canonicalTimestamp}.${rawBody}`)
    .digest('base64');
  return `v1,${digest}`;
}

/** Independently reproduces the legacy signing algorithm for test fixtures. */
function signLegacy(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

describe('CreemWebhookVerifier', () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);

  describe('standard-webhook scheme', () => {
    it('verifies a correctly-signed request', () => {
      const id = 'msg_1';
      const timestamp = String(nowSeconds());
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const signature = signStandard(
        id,
        timestamp,
        rawBody,
        SECRET_WITH_PREFIX,
      );

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': signature,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(true);
    });

    it('rejects a tampered body', () => {
      const id = 'msg_2';
      const timestamp = String(nowSeconds());
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const signature = signStandard(
        id,
        timestamp,
        rawBody,
        SECRET_WITH_PREFIX,
      );
      const tamperedBody = JSON.stringify({
        eventType: 'subscription.paid.evil',
      });

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': signature,
        },
        tamperedBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);
    });

    it('rejects a timestamp older than the 300s replay window', () => {
      const id = 'msg_3';
      const timestamp = String(nowSeconds() - 301);
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const signature = signStandard(
        id,
        timestamp,
        rawBody,
        SECRET_WITH_PREFIX,
      );

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': signature,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);
    });

    it('rejects a timestamp far in the future', () => {
      const id = 'msg_4';
      const timestamp = String(nowSeconds() + 301);
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const signature = signStandard(
        id,
        timestamp,
        rawBody,
        SECRET_WITH_PREFIX,
      );

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': signature,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);
    });

    it('accepts when webhook-signature carries multiple space-delimited pairs and any v1 pair matches', () => {
      const id = 'msg_5';
      const timestamp = String(nowSeconds());
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const validV1 = signStandard(id, timestamp, rawBody, SECRET_WITH_PREFIX);
      const compoundHeader = `v2,not-a-real-signature ${validV1} v3,another-fake`;

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': compoundHeader,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(true);
    });

    it('rejects when only a non-v1 version tag is present', () => {
      const id = 'msg_6';
      const timestamp = String(nowSeconds());
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      // Compute a "correct" HMAC but tag it v2 instead of v1 — must not be accepted.
      const stripped = SECRET_WITH_PREFIX.slice('whsec_'.length);
      const key = Buffer.from(stripped, 'base64');
      const digest = crypto
        .createHmac('sha256', key)
        .update(`${id}.${timestamp}.${rawBody}`)
        .digest('base64');

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': `v2,${digest}`,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);
    });

    it('derives the standard-scheme key by stripping whsec_ and base64-decoding; swapping derivations fails', () => {
      const id = 'msg_7';
      const timestamp = String(nowSeconds());
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });

      // Sign using the LEGACY derivation (raw secret string, hex) but present
      // it as a standard-scheme v1 signature — must fail, proving the two
      // key derivations are not interchangeable.
      const wrongDerivationSig = crypto
        .createHmac('sha256', SECRET_WITH_PREFIX)
        .update(`${id}.${timestamp}.${rawBody}`)
        .digest('base64');

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': `v1,${wrongDerivationSig}`,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);

      // The correct derivation (stripped + base64-decoded) does verify.
      // `signStandard` already returns the full "v1,<sig>" header value.
      const correctSignatureHeader = signStandard(
        id,
        timestamp,
        rawBody,
        SECRET_WITH_PREFIX,
      );
      const correctResult = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': correctSignatureHeader,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );
      expect(correctResult).toBe(true);
    });

    it('signs the parsed timestamp value, not the raw header string (leading-zero timestamp)', () => {
      const id = 'msg_leading_zero';
      const currentTimestamp = nowSeconds();
      // Same integer value as `currentTimestamp`, but a different, non-canonical string.
      const nonCanonicalTimestamp = `0${currentTimestamp}`;
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });

      // Computed against the CANONICAL (parsed) timestamp — this is what the
      // implementation is expected to sign
      // (docs/specs/creem-sdk-surface.md § "Webhook verification":
      // `webhooks.js:113-117` parses with `Number.parseInt` before building
      // the signed message). If the implementation instead signed the raw,
      // non-canonical header string, this signature would NOT match.
      const signature = signStandard(
        id,
        String(currentTimestamp),
        rawBody,
        SECRET_WITH_PREFIX,
      );

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': nonCanonicalTimestamp,
          'webhook-signature': signature,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(true);
    });
  });

  describe('legacy scheme', () => {
    it('verifies via creem-signature', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.canceled' });
      const signature = signLegacy(rawBody, LEGACY_SECRET);

      const result = CreemWebhookVerifier.verify(
        { 'creem-signature': signature },
        rawBody,
        LEGACY_SECRET,
      );

      expect(result).toBe(true);
    });

    it('verifies via x-creem-signature', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.canceled' });
      const signature = signLegacy(rawBody, LEGACY_SECRET);

      const result = CreemWebhookVerifier.verify(
        { 'x-creem-signature': signature },
        rawBody,
        LEGACY_SECRET,
      );

      expect(result).toBe(true);
    });

    it('strips a leading sha256= prefix if present', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.canceled' });
      const signature = signLegacy(rawBody, LEGACY_SECRET);

      const result = CreemWebhookVerifier.verify(
        { 'creem-signature': `sha256=${signature}` },
        rawBody,
        LEGACY_SECRET,
      );

      expect(result).toBe(true);
    });

    it('rejects a tampered body', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.canceled' });
      const signature = signLegacy(rawBody, LEGACY_SECRET);
      const tamperedBody = JSON.stringify({ eventType: 'subscription.evil' });

      const result = CreemWebhookVerifier.verify(
        { 'creem-signature': signature },
        tamperedBody,
        LEGACY_SECRET,
      );

      expect(result).toBe(false);
    });
  });

  describe('scheme selection and hostile input', () => {
    it('rejects partial standard headers instead of falling through to legacy (downgrade oracle)', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      // A valid LEGACY signature for this body+secret — if the implementation
      // wrongly fell through to legacy on partial standard headers, this
      // would incorrectly verify.
      const legacySig = signLegacy(rawBody, SECRET_WITH_PREFIX);

      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const result = CreemWebhookVerifier.verify(
        {
          // webhook-signature present, but webhook-timestamp is missing —
          // malformed standard scheme, must NOT fall through to legacy even
          // though 'creem-signature' is absent here (nothing to fall through
          // to) and even though the header value below is a valid legacy sig.
          'webhook-id': 'msg_8',
          'webhook-signature': legacySig,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);

      // Prove CAUSE, not just outcome: an implementation that wrongly routed
      // to the legacy path and merely failed to match the (deliberately
      // mismatched-body) legacy signature would also return `false` here —
      // this assertion is what actually distinguishes "never attempted
      // legacy" from "attempted legacy and it happened to fail".
      const loggedContexts = warnSpy.mock.calls.map(
        (call) => call[1] as { scheme?: string; reason?: string },
      );
      expect(loggedContexts).toContainEqual(
        expect.objectContaining({
          scheme: 'standard',
          reason: 'missing-headers',
        }),
      );
      expect(loggedContexts.map((c) => c.scheme)).not.toContain('legacy');

      warnSpy.mockRestore();
    });

    it('rejects partial standard headers even when a valid legacy header is also present', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const legacySig = signLegacy(rawBody, SECRET_WITH_PREFIX);

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': 'msg_9',
          // webhook-timestamp and webhook-signature both missing — but
          // webhook-id alone is present, which must still force "standard
          // scheme selected, malformed" rather than "no standard headers,
          // try legacy".
          'creem-signature': legacySig,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);
    });

    it('rejects when neither scheme headers are present, without attempting legacy verification', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });

      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const result = CreemWebhookVerifier.verify(
        {},
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);

      // No legacy signature was ever present to attempt — the logged scheme
      // must reflect that (not 'legacy', which would only be logged after
      // actually running the legacy HMAC comparison and having it fail).
      const loggedContexts = warnSpy.mock.calls.map(
        (call) => call[1] as { scheme?: string; reason?: string },
      );
      expect(loggedContexts).toContainEqual(
        expect.objectContaining({
          scheme: 'unknown',
          reason: 'missing-headers',
        }),
      );
      expect(loggedContexts.map((c) => c.scheme)).not.toContain('legacy');

      warnSpy.mockRestore();
    });

    it('rejects an empty/missing signature (the historical bypass bug)', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });

      const result = CreemWebhookVerifier.verify(
        { 'creem-signature': '' },
        rawBody,
        LEGACY_SECRET,
      );

      expect(result).toBe(false);
    });

    it('treats creem-signature arriving as a string[] as absent', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const signature = signLegacy(rawBody, LEGACY_SECRET);

      const result = CreemWebhookVerifier.verify(
        {
          'creem-signature': [signature, signature],
        } as unknown as WebhookHeaders,
        rawBody,
        LEGACY_SECRET,
      );

      expect(result).toBe(false);
    });

    it('rejects when webhook-id arrives as a string[] alongside otherwise-valid standard headers (malformed, no downgrade)', () => {
      const timestamp = String(nowSeconds());
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const validSignature = signStandard(
        'real-id',
        timestamp,
        rawBody,
        SECRET_WITH_PREFIX,
      );

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': ['real-id', 'attacker-smuggled-id'],
          'webhook-timestamp': timestamp,
          'webhook-signature': validSignature,
        } as unknown as WebhookHeaders,
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);
    });

    it('rejects when webhook-timestamp arrives as a string[] alongside otherwise-valid standard headers', () => {
      const timestamp = String(nowSeconds());
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const validSignature = signStandard(
        'msg_ts_array',
        timestamp,
        rawBody,
        SECRET_WITH_PREFIX,
      );

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': 'msg_ts_array',
          'webhook-timestamp': [timestamp, timestamp],
          'webhook-signature': validSignature,
        } as unknown as WebhookHeaders,
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);
    });

    it('rejects when webhook-signature arrives as a string[] alongside otherwise-valid standard headers', () => {
      const timestamp = String(nowSeconds());
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const validSignature = signStandard(
        'msg_sig_array',
        timestamp,
        rawBody,
        SECRET_WITH_PREFIX,
      );

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': 'msg_sig_array',
          'webhook-timestamp': timestamp,
          'webhook-signature': [validSignature, validSignature],
        } as unknown as WebhookHeaders,
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);
    });

    it('rejects garbage/near-valid-length hex in the legacy signature rather than accidentally accepting it', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });

      // 63 valid hex characters + 1 invalid character (64 total — the same
      // length as a correctly-formed sha256 hex signature). Buffer.from(s,
      // 'hex') stops at the first invalid byte pair and silently returns
      // fewer bytes instead of throwing, producing a 31-byte buffer here —
      // one byte short of the expected 32. This exercises the actual case
      // the length guard defends against (an "almost right" length), unlike
      // a garbage string that fails to parse from its very first character.
      const almostValidHex = 'a'.repeat(63) + 'z';

      const result = CreemWebhookVerifier.verify(
        { 'creem-signature': almostValidHex },
        rawBody,
        LEGACY_SECRET,
      );

      expect(result).toBe(false);
    });

    it('rejects garbage base64 in the standard-scheme v1 signature', () => {
      const id = 'msg_10';
      const timestamp = String(nowSeconds());
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });

      const result = CreemWebhookVerifier.verify(
        {
          'webhook-id': id,
          'webhook-timestamp': timestamp,
          'webhook-signature': 'v1,###not-base64-and-wrong-length###',
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );

      expect(result).toBe(false);
    });

    it('returns false without throwing when CREEM_WEBHOOK_SECRET is missing', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const signature = signLegacy(rawBody, LEGACY_SECRET);

      expect(() =>
        CreemWebhookVerifier.verify(
          { 'creem-signature': signature },
          rawBody,
          undefined as unknown as string,
        ),
      ).not.toThrow();

      const result = CreemWebhookVerifier.verify(
        { 'creem-signature': signature },
        rawBody,
        undefined as unknown as string,
      );
      expect(result).toBe(false);
    });

    it('returns false without throwing when secret is an empty string', () => {
      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });

      expect(() =>
        CreemWebhookVerifier.verify({ 'creem-signature': 'abc' }, rawBody, ''),
      ).not.toThrow();
      expect(
        CreemWebhookVerifier.verify({ 'creem-signature': 'abc' }, rawBody, ''),
      ).toBe(false);
    });
  });

  describe('logging safety', () => {
    it('never logs the secret, computed digest, or full signature header', () => {
      const loggedMessages: string[] = [];
      const captureLog = (message: unknown, ...rest: unknown[]) => {
        loggedMessages.push(
          [message, ...rest]
            .map((part) =>
              typeof part === 'string' ? part : JSON.stringify(part),
            )
            .join(' '),
        );
      };

      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(captureLog);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(captureLog);
      const logSpy = jest
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(captureLog);

      const rawBody = JSON.stringify({ eventType: 'subscription.paid' });
      const legacySig = signLegacy(rawBody, LEGACY_SECRET);
      const standardSig = signStandard(
        'msg_log',
        String(nowSeconds()),
        rawBody,
        SECRET_WITH_PREFIX,
      );

      // Exercise several paths, including failures, to maximize log surface.
      CreemWebhookVerifier.verify(
        { 'creem-signature': legacySig },
        rawBody,
        LEGACY_SECRET,
      );
      CreemWebhookVerifier.verify(
        { 'creem-signature': 'tampered-value' },
        rawBody,
        LEGACY_SECRET,
      );
      CreemWebhookVerifier.verify(
        {
          'webhook-id': 'msg_log',
          'webhook-timestamp': String(nowSeconds()),
          'webhook-signature': `v1,${standardSig.split(',')[1]}`,
        },
        rawBody,
        SECRET_WITH_PREFIX,
      );
      CreemWebhookVerifier.verify(
        { 'creem-signature': legacySig },
        rawBody,
        undefined as unknown as string,
      );

      const allLogs = loggedMessages.join('\n');
      expect(allLogs).not.toContain(LEGACY_SECRET);
      expect(allLogs).not.toContain(SECRET_WITH_PREFIX);
      expect(allLogs).not.toContain(legacySig);
      expect(allLogs).not.toContain(standardSig);

      warnSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    });
  });
});

describe('CreemWebhookParser', () => {
  it('parses subscription.paid to SUBSCRIPTION_RENEWED with gatewayTransactionId from lastTransactionId', () => {
    const payload = {
      id: 'evt_1',
      eventType: 'subscription.paid',
      object: {
        id: 'sub_1',
        status: 'active',
        mode: 'test',
        lastTransactionId: 'txn_1',
      },
    };
    const rawBody = JSON.stringify(payload);
    const parsed = CreemWebhookParser.parse(JSON.parse(rawBody));

    expect(parsed.type).toBe(PaymentEventType.SUBSCRIPTION_RENEWED);
    expect(parsed.gatewayTransactionId).toBe('txn_1');
    expect(parsed.gatewaySubscriptionId).toBe('sub_1');
  });

  it('parses checkout.completed reading the subscription id from object.subscription (expanded object form)', () => {
    const payload = {
      id: 'evt_2',
      eventType: 'checkout.completed',
      object: {
        id: 'chk_1',
        mode: 'prod',
        subscription: { id: 'sub_2' },
      },
    };
    const parsed = CreemWebhookParser.parse(
      JSON.parse(JSON.stringify(payload)),
    );

    expect(parsed.type).toBe(PaymentEventType.SUBSCRIPTION_ACTIVATED);
    expect(parsed.gatewaySubscriptionId).toBe('sub_2');
  });

  it('parses checkout.completed reading the subscription id from object.subscription (bare string form)', () => {
    const payload = {
      id: 'evt_3',
      eventType: 'checkout.completed',
      object: {
        id: 'chk_2',
        mode: 'prod',
        subscription: 'sub_3',
      },
    };
    const parsed = CreemWebhookParser.parse(
      JSON.parse(JSON.stringify(payload)),
    );

    expect(parsed.gatewaySubscriptionId).toBe('sub_3');
  });

  it('parses refund.created nesting subscription under object.subscription and transaction id from transaction.id', () => {
    const payload = {
      id: 'evt_4',
      eventType: 'refund.created',
      object: {
        id: 'refund_1',
        mode: 'prod',
        subscription: { id: 'sub_4' },
        transaction: { id: 'txn_4' },
      },
    };
    const parsed = CreemWebhookParser.parse(
      JSON.parse(JSON.stringify(payload)),
    );

    expect(parsed.type).toBe(PaymentEventType.PAYMENT_REFUNDED);
    expect(parsed.gatewaySubscriptionId).toBe('sub_4');
    expect(parsed.gatewayTransactionId).toBe('txn_4');
  });

  it('parses dispute.created nesting subscription under object.subscription and transaction id from transaction.id', () => {
    const payload = {
      id: 'evt_5',
      eventType: 'dispute.created',
      object: {
        id: 'dispute_1',
        mode: 'prod',
        subscription: { id: 'sub_5' },
        transaction: { id: 'txn_5' },
      },
    };
    const parsed = CreemWebhookParser.parse(
      JSON.parse(JSON.stringify(payload)),
    );

    expect(parsed.type).toBe(PaymentEventType.PAYMENT_DISPUTED);
    expect(parsed.gatewaySubscriptionId).toBe('sub_5');
    expect(parsed.gatewayTransactionId).toBe('txn_5');
  });

  it('parses subscription.scheduled_cancel to SUBSCRIPTION_CANCEL_SCHEDULED, not SUBSCRIPTION_CANCELLED', () => {
    const payload = {
      id: 'evt_6',
      eventType: 'subscription.scheduled_cancel',
      object: { id: 'sub_6', status: 'scheduled_cancel', mode: 'prod' },
    };
    const parsed = CreemWebhookParser.parse(
      JSON.parse(JSON.stringify(payload)),
    );

    expect(parsed.type).toBe(PaymentEventType.SUBSCRIPTION_CANCEL_SCHEDULED);
    expect(parsed.type).not.toBe(PaymentEventType.SUBSCRIPTION_CANCELLED);
  });

  it('maps an unrecognised eventType to UNKNOWN without throwing', () => {
    const payload = {
      id: 'evt_7',
      eventType: 'subscription.some_future_event',
      object: { id: 'sub_7', mode: 'prod' },
    };

    expect(() =>
      CreemWebhookParser.parse(JSON.parse(JSON.stringify(payload))),
    ).not.toThrow();

    const parsed = CreemWebhookParser.parse(
      JSON.parse(JSON.stringify(payload)),
    );
    expect(parsed.type).toBe(PaymentEventType.UNKNOWN);
  });

  it('degrades null payload to UNKNOWN without throwing', () => {
    expect(() => CreemWebhookParser.parse(null)).not.toThrow();
    expect(CreemWebhookParser.parse(null).type).toBe(PaymentEventType.UNKNOWN);
  });

  it('degrades a string payload to UNKNOWN without throwing', () => {
    expect(() => CreemWebhookParser.parse('not-an-object')).not.toThrow();
    expect(CreemWebhookParser.parse('not-an-object').type).toBe(
      PaymentEventType.UNKNOWN,
    );
  });

  it('degrades a payload missing object to UNKNOWN without throwing', () => {
    const payload = { id: 'evt_8', eventType: 'subscription.paid' };

    expect(() =>
      CreemWebhookParser.parse(JSON.parse(JSON.stringify(payload))),
    ).not.toThrow();
    const parsed = CreemWebhookParser.parse(
      JSON.parse(JSON.stringify(payload)),
    );
    expect(parsed.type).toBe(PaymentEventType.UNKNOWN);
  });

  it('leaves status undefined for an unmapped Creem status (not EXPIRED)', () => {
    const payload = {
      id: 'evt_9',
      eventType: 'subscription.paid',
      object: { id: 'sub_9', status: 'some_future_status', mode: 'prod' },
    };
    const parsed = CreemWebhookParser.parse(
      JSON.parse(JSON.stringify(payload)),
    );

    expect(parsed.status).toBeUndefined();
    expect(parsed.status).not.toBe(SubscriptionStatus.EXPIRED);
  });

  it('leaves periodStart/periodEnd undefined when absent (not the epoch)', () => {
    const payload = {
      id: 'evt_10',
      eventType: 'subscription.paid',
      object: { id: 'sub_10', status: 'active', mode: 'prod' },
    };
    const parsed = CreemWebhookParser.parse(
      JSON.parse(JSON.stringify(payload)),
    );

    expect(parsed.periodStart).toBeUndefined();
    expect(parsed.periodEnd).toBeUndefined();
  });

  it('maps mode "test" and "sandbox" to isTestMode true, and "prod" to false', () => {
    const testPayload = {
      id: 'evt_11',
      eventType: 'subscription.paid',
      object: { id: 'sub_11', mode: 'test' },
    };
    const sandboxPayload = {
      id: 'evt_12',
      eventType: 'subscription.paid',
      object: { id: 'sub_12', mode: 'sandbox' },
    };
    const prodPayload = {
      id: 'evt_13',
      eventType: 'subscription.paid',
      object: { id: 'sub_13', mode: 'prod' },
    };

    expect(
      CreemWebhookParser.parse(JSON.parse(JSON.stringify(testPayload)))
        .isTestMode,
    ).toBe(true);
    expect(
      CreemWebhookParser.parse(JSON.parse(JSON.stringify(sandboxPayload)))
        .isTestMode,
    ).toBe(true);
    expect(
      CreemWebhookParser.parse(JSON.parse(JSON.stringify(prodPayload)))
        .isTestMode,
    ).toBe(false);
  });

  describe('prototype-chain lookup hazard', () => {
    /**
     * `eventType` and `object.status` are ordinary attacker-controlled JSON
     * string fields — no getters or Proxies needed, `JSON.parse` alone
     * produces these as real own properties. A plain-object lookup
     * (`{}[key]`) inherits from `Object.prototype`, so `"__proto__"` /
     * `"constructor"` / `"toString"` / `"hasOwnProperty"` resolve to real,
     * truthy prototype members instead of `undefined` — silently defeating
     * the `?? UNKNOWN` / no-fallback logic. `EVENT_TYPE_MAP` and
     * `CREEM_STATUS_MAP` are `Map`s specifically to make this impossible.
     */
    it.each(['__proto__', 'constructor'])(
      'treats eventType %j as unrecognised, not a prototype-chain hit',
      (proto) => {
        const payload = {
          id: `evt_proto_${proto}`,
          eventType: proto,
          object: { id: 'sub_proto', mode: 'prod' },
        };
        const parsed = CreemWebhookParser.parse(
          JSON.parse(JSON.stringify(payload)),
        );

        expect(parsed.type).toBe(PaymentEventType.UNKNOWN);
      },
    );

    it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
      'leaves status undefined for the prototype-chain key %j, not a function/object from Object.prototype',
      (proto) => {
        const payload = {
          id: `evt_status_${proto}`,
          eventType: 'subscription.paid',
          object: { id: 'sub_status_proto', status: proto, mode: 'prod' },
        };
        const parsed = CreemWebhookParser.parse(
          JSON.parse(JSON.stringify(payload)),
        );

        expect(parsed.status).toBeUndefined();
      },
    );
  });

  describe('never-throws contract', () => {
    it('does not throw when the payload has a getter that throws on every access', () => {
      const evilPayload: Record<string, unknown> = {};
      Object.defineProperty(evilPayload, 'id', {
        enumerable: true,
        get(): string {
          throw new Error('evil getter for id');
        },
      });
      Object.defineProperty(evilPayload, 'eventType', {
        enumerable: true,
        get(): string {
          throw new Error('evil getter for eventType');
        },
      });

      expect(() => CreemWebhookParser.parse(evilPayload)).not.toThrow();

      const parsed = CreemWebhookParser.parse(evilPayload);
      expect(parsed.type).toBe(PaymentEventType.UNKNOWN);
    });
  });
});
