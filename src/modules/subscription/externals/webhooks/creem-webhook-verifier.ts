import * as crypto from 'node:crypto';
import { Logger } from '@nestjs/common';
import { WebhookHeaders } from '../interfaces/payment-gateway.interface';

/**
 * Creem Webhook Verifier
 *
 * Verifies the authenticity of an inbound Creem webhook against its raw
 * request body. This endpoint (`POST /api/v1/subscriptions/payment-confirmation`)
 * is `@Public()`, unauthenticated, and internet-facing — this is the entire
 * security boundary standing between an anonymous caller and granting paid
 * access. See `docs/superpowers/plans/2026-08-03-lemonsqueezy-to-creem-migration.md`
 * § "Security controls for the webhook path" for the binding requirements
 * this class implements, and `docs/specs/creem-sdk-surface.md` § "Webhook
 * verification" for the algorithm (read off Creem SDK's compiled
 * `webhooks.js`, authoritative over any other description).
 *
 * Deliberate deviation from the SDK's own `verifyWebhookSignature`: the SDK
 * falls through from the standard scheme to the legacy scheme whenever any
 * standard header is missing. We do NOT replicate that — legacy has no replay
 * protection, so silently falling through on a partially-formed standard
 * header set would let an attacker downgrade to the weaker scheme. Here,
 * scheme selection is deterministic and a partial standard header set is
 * rejected outright, never treated as "no standard headers, try legacy".
 *
 * Static, dependency-free (no `@Injectable()`, no constructor DI) so it can
 * be unit tested without a Nest testing module or mocks — precedent:
 * `IdValidator` (`src/shared/validators/id.validator.ts`).
 */

const REPLAY_WINDOW_SECONDS = 300;
const WHSEC_PREFIX = 'whsec_';
const LEGACY_SHA256_PREFIX = 'sha256=';

type VerificationScheme = 'standard' | 'legacy' | 'unknown';
type RejectionReason =
  | 'missing-secret'
  | 'missing-headers'
  | 'timestamp-expired'
  | 'signature-mismatch'
  | 'malformed-body';

export class CreemWebhookVerifier {
  private static readonly logger = new Logger(CreemWebhookVerifier.name);

  /**
   * Verifies an inbound webhook. Never throws — any unexpected failure
   * degrades to `false`. Never logs the secret, computed digest, or full
   * signature header; only the scheme attempted, outcome, and a coarse
   * reason category, plus the `webhook-id` when available.
   */
  static verify(
    headers: WebhookHeaders,
    rawBody: string,
    secret: string,
  ): boolean {
    try {
      if (!secret) {
        this.logOutcome('unknown', false, 'missing-secret');
        return false;
      }

      if (typeof rawBody !== 'string') {
        this.logOutcome('unknown', false, 'malformed-body');
        return false;
      }

      const webhookId = this.readHeader(headers, 'webhook-id');
      const webhookTimestamp = this.readHeader(headers, 'webhook-timestamp');
      const webhookSignature = this.readHeader(headers, 'webhook-signature');

      const hasAnyStandardHeader =
        webhookId !== undefined ||
        webhookTimestamp !== undefined ||
        webhookSignature !== undefined;
      const hasAllStandardHeaders =
        webhookId !== undefined &&
        webhookTimestamp !== undefined &&
        webhookSignature !== undefined;

      if (hasAllStandardHeaders) {
        return this.verifyStandardScheme(
          webhookId,
          webhookTimestamp,
          webhookSignature,
          rawBody,
          secret,
        );
      }

      if (hasAnyStandardHeader) {
        // Partial standard headers = malformed = reject. This is the
        // downgrade-oracle guard: never fall through to legacy from here.
        this.logOutcome('standard', false, 'missing-headers', webhookId);
        return false;
      }

      const legacySignature =
        this.readHeader(headers, 'creem-signature') ??
        this.readHeader(headers, 'x-creem-signature');

      if (legacySignature !== undefined) {
        return this.verifyLegacyScheme(legacySignature, rawBody, secret);
      }

      // No header from either scheme was present at all — distinct from
      // 'legacy' (which would imply a legacy signature was actually
      // attempted and failed to match). Kept accurate so log-based tests can
      // prove the legacy path was never entered on this branch.
      this.logOutcome('unknown', false, 'missing-headers');
      return false;
    } catch {
      // No catch on this path may resolve to "accepted".
      this.logOutcome('unknown', false, 'malformed-body');
      return false;
    }
  }

  /**
   * Reads a header value, treating anything other than a non-empty string
   * (array, undefined, empty string) as absent. Never coerces via
   * `String()`/`.join()`/`[0]` — an array header is a request smuggling two
   * values under one name and must not be silently collapsed to one.
   */
  private static readHeader(
    headers: WebhookHeaders,
    name: string,
  ): string | undefined {
    const value = headers?.[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private static verifyStandardScheme(
    id: string,
    timestamp: string,
    signatureHeader: string,
    rawBody: string,
    secret: string,
  ): boolean {
    const parsedTimestamp = Number.parseInt(timestamp, 10);
    if (!Number.isFinite(parsedTimestamp)) {
      this.logOutcome('standard', false, 'malformed-body', id);
      return false;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - parsedTimestamp) > REPLAY_WINDOW_SECONDS) {
      // Reject on timestamp BEFORE any signature comparison.
      this.logOutcome('standard', false, 'timestamp-expired', id);
      return false;
    }

    const strippedSecret = secret.startsWith(WHSEC_PREFIX)
      ? secret.slice(WHSEC_PREFIX.length)
      : secret;
    const key = Buffer.from(strippedSecret, 'base64');

    // Sign the PARSED timestamp, not the raw header string — matches the
    // authoritative algorithm (`webhooks.js:113-117` parses with
    // `Number.parseInt` before building the signed message). For any
    // canonical timestamp these are identical, but a non-canonical-yet-
    // parseable value (e.g. a leading zero) would otherwise sign a different
    // byte sequence than the SDK does.
    const expected = crypto
      .createHmac('sha256', key)
      .update(`${id}.${parsedTimestamp}.${rawBody}`)
      .digest();

    const pairs = signatureHeader.split(/\s+/).filter(Boolean);
    for (const pair of pairs) {
      const commaIndex = pair.indexOf(',');
      if (commaIndex === -1) {
        continue;
      }

      const version = pair.slice(0, commaIndex);
      if (version !== 'v1') {
        // Only v1 pairs are ever compared — an unknown version tag alone
        // (e.g. only a v2 pair present) can never accept.
        continue;
      }

      const candidate = pair.slice(commaIndex + 1);
      let candidateBuffer: Buffer;
      try {
        candidateBuffer = Buffer.from(candidate, 'base64');
      } catch {
        continue;
      }

      if (candidateBuffer.length !== expected.length) {
        // `Buffer.from(s, 'base64')` does not throw on malformed input; the
        // length guard is what actually rejects garbage.
        continue;
      }

      if (crypto.timingSafeEqual(candidateBuffer, expected)) {
        this.logOutcome('standard', true, undefined, id);
        return true;
      }
    }

    this.logOutcome('standard', false, 'signature-mismatch', id);
    return false;
  }

  private static verifyLegacyScheme(
    signatureHeader: string,
    rawBody: string,
    secret: string,
  ): boolean {
    const normalized = signatureHeader
      .toLowerCase()
      .startsWith(LEGACY_SHA256_PREFIX)
      ? signatureHeader.slice(LEGACY_SHA256_PREFIX.length)
      : signatureHeader;

    let candidateBuffer: Buffer;
    try {
      candidateBuffer = Buffer.from(normalized, 'hex');
    } catch {
      this.logOutcome('legacy', false, 'malformed-body');
      return false;
    }

    // Raw secret string, never decoded — deliberately different derivation
    // from the standard scheme's stripped+base64-decoded key.
    const expected = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest();

    if (candidateBuffer.length !== expected.length) {
      // `Buffer.from(s, 'hex')` silently truncates on odd-length/invalid hex
      // instead of throwing — this length guard is the actual rejection.
      this.logOutcome('legacy', false, 'signature-mismatch');
      return false;
    }

    if (crypto.timingSafeEqual(candidateBuffer, expected)) {
      this.logOutcome('legacy', true);
      return true;
    }

    this.logOutcome('legacy', false, 'signature-mismatch');
    return false;
  }

  /**
   * Logs scheme attempted, outcome, and a coarse reason category only.
   * Never logs the secret (any form), the computed digest, or the full
   * signature header.
   */
  private static logOutcome(
    scheme: VerificationScheme,
    verified: boolean,
    reason?: RejectionReason,
    webhookId?: string,
  ): void {
    const context = {
      scheme,
      verified,
      ...(reason ? { reason } : {}),
      ...(webhookId ? { webhookId } : {}),
    };

    if (verified) {
      this.logger.log('Creem webhook signature verified', context);
    } else {
      this.logger.warn('Creem webhook signature rejected', context);
    }
  }
}
