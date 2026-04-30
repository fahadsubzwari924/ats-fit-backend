export interface PostExpiryOffer {
  eligible: true;
  monthly_price_usd: number;
  price_monthly: number;
  discount_pct: number;
}

export class BetaStatusResponseDto {
  status: 'pending' | 'active' | 'expired' | 'not_invited';
  is_beta_user: boolean;
  has_pending_redemption: boolean;
  beta_access_until: Date | null;
  days_remaining: number | null;
  founding_rate_locked: boolean;
  post_expiry_offer: PostExpiryOffer | null;
}
