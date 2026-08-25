/**
 * Normalized Webhook Event Interface
 *
 * The provider-neutral shape every payment gateway adapter must produce
 * from an inbound webhook payload. Downstream services (subscription,
 * payment history) consume only this shape and never reach into a
 * provider's raw JSON.
 */

import { PaymentEventType } from '../../enums/payment-event-type.enum';
import { SubscriptionStatus } from '../../enums/subscription-status.enum';
import { Currency } from '../../enums/payment.enum';

export interface NormalizedWebhookEvent {
  eventId: string;
  type: PaymentEventType;
  rawType: string;
  gatewaySubscriptionId?: string;
  gatewayTransactionId?: string;
  gatewayCustomerId?: string;
  gatewayProductId?: string;
  status?: SubscriptionStatus;
  amountCents?: number;
  currency?: Currency;
  periodStart?: Date;
  periodEnd?: Date;
  cancelledAt?: Date;
  customerEmail?: string;
  isTestMode: boolean;
  metadata: Record<string, unknown>;
  raw: unknown;
}
