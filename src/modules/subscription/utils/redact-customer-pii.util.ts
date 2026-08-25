/**
 * Redact Customer PII (webhook payload, pre-persistence)
 *
 * GDPR Art. 5(1)(c) (data minimisation): Creem is the Merchant of Record and
 * holds the statutory tax/customer record, so `payment_history` is a
 * legitimate-interest business record with no statutory retention behind it.
 * Storing the customer's contact details a second time — verbatim and
 * indefinitely — inside `payment_gateway_response` is a redundant copy, and
 * that redundant copy is what this function strips before the jsonb blob is
 * ever written.
 *
 * The forensic value of the stored payload is in its structural fields —
 * amounts, statuses, transaction/subscription/order ids, timestamps — which
 * is what a dispute review actually references. Creem remains the system of
 * record for the customer object and can be re-queried by `customer.id` if a
 * real dispute ever needs it, so `customer.id` (the join key), `country`,
 * `mode`, and all timestamps are deliberately kept, not redacted.
 *
 * `payment_history.customer_email` (a dedicated column populated separately
 * in `PaymentHistoryService.claimPaymentEvent`) is NOT touched by this
 * function — that column is the one intentional, purpose-built copy kept for
 * support lookups. This function only removes the redundant second copy
 * living inside the jsonb blob.
 *
 * Recursive by design, not hard-coded to `object.customer`: verified from the
 * SDK types, `refund.created` and `dispute.created` events carry
 * `object.subscription`, which can itself carry an expanded `customer`
 * object nested one level deeper than the top-level `object.customer`.
 * Rather than enumerate every path a `customer` object can appear at (and
 * silently miss the next one Creem adds), this walks the entire payload and
 * redacts every object found under a `customer` key, at any depth.
 *
 * Clones as it walks — every object/array level is rebuilt fresh, the input
 * is never reused by reference — so the argument is never mutated.
 * `CreemWebhookParser` is a pure, side-effect-free static class and other
 * code may still hold and read `event.raw` after this runs; this function
 * must never be the thing that breaks that contract.
 *
 * Rebuilt objects use `Object.create(null)` rather than `{}`. `event.raw`
 * originates as `JSON.parse`d, fully attacker-controlled input. `JSON.parse`
 * itself cannot produce a polluted prototype, but *rebuilding* an object via
 * plain-literal bracket assignment (`result[key] = value`) can:
 * `"__proto__"` is a special accessor inherited from `Object.prototype`, so
 * `result['__proto__'] = x` on an ordinary `{}` mutates that object's actual
 * prototype instead of setting a normal own property. A null-prototype
 * target has no such accessor anywhere in its chain, so the same assignment
 * is structurally just a plain own property — immune by construction, not by
 * convention. (Same class of concern this codebase already treats with a
 * `Map` in `creem-webhook-parser.ts`'s `EVENT_TYPE_MAP` / `CREEM_STATUS_MAP`.)
 * `JSON.stringify` and `Object.keys`/`Object.entries` all operate on own
 * enumerable properties regardless of prototype, so this has no effect on
 * the persisted output.
 */

const CUSTOMER_KEY = 'customer';
const CONTACT_PII_KEYS: ReadonlySet<string> = new Set([
  'email',
  'name',
  'metadata',
]);

export function redactCustomerPii(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactCustomerPii(item));
  }

  if (value instanceof Date) {
    // Real Date instances never appear in a JSON.parse'd webhook body, but
    // pass them through unchanged rather than let the generic object branch
    // below flatten them to `{}` (Date has no own enumerable properties).
    return value;
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = Object.create(null);

    for (const key of Object.keys(source)) {
      const child = source[key];
      result[key] =
        key === CUSTOMER_KEY &&
        child !== null &&
        typeof child === 'object' &&
        !Array.isArray(child)
          ? redactCustomerObject(child as Record<string, unknown>)
          : redactCustomerPii(child);
    }

    return result;
  }

  // Primitive (string, number, boolean, null, undefined) — nothing to clone
  // or redact.
  return value;
}

/**
 * Strips `email`, `name`, `metadata` from an expanded `customer` object and
 * recursively redacts whatever remains (a customer object could in
 * principle nest another `customer`-keyed object; unlikely today, but this
 * does not assume it can't).
 */
function redactCustomerObject(
  customer: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);

  for (const key of Object.keys(customer)) {
    if (CONTACT_PII_KEYS.has(key)) {
      continue;
    }
    result[key] = redactCustomerPii(customer[key]);
  }

  return result;
}
