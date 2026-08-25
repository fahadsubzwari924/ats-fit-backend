export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  PAUSED = 'paused',
  PAST_DUE = 'past_due',
  /**
   * Present in the `user_subscriptions_status_enum` Postgres type as of
   * migration `RenameVariantToProductAndAddCustomerId1815300000000`.
   * Safe to persist. Note `down()` of that migration deliberately REFUSES
   * to run while any row holds this value — remapping it to `cancelled` or
   * `active` is an access-control decision the migration will not make.
   */
  SCHEDULED_CANCEL = 'scheduled_cancel',
}
