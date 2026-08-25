import { PaymentHistory } from '../../../database/entities/payment-history.entity';

/**
 * Outcome of `PaymentHistoryService.claimPaymentEvent`'s atomic claim UPSERT.
 *
 * - `reserved`  — this delivery created the `payment_history` row; it is the
 *                 first attempt to see this transaction id. Run the handler.
 * - `retry`     — a row already existed (a prior attempt died mid-flight, or
 *                 its claim went stale) and this delivery just re-claimed it.
 *                 Run the handler — this outcome is informational only, it
 *                 does not change caller behaviour.
 * - `duplicate` — the row is already `processed_at IS NOT NULL`, or another
 *                 delivery holds a fresh (non-stale) claim right now. Skip
 *                 the handler and return 200.
 *
 * `reserved` vs `retry` is derived from the same INSERT ... ON CONFLICT
 * statement via Postgres's `(xmax = 0)` trick (true only for a tuple this
 * statement itself inserted) — no extra round trip.
 */
export type PaymentClaimOutcome = 'reserved' | 'retry' | 'duplicate';

export interface PaymentClaimResult {
  outcome: PaymentClaimOutcome;
  row: PaymentHistory;
}
