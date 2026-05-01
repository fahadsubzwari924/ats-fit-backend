import type { PayPeriod } from '../enums/pay-period.enum';

export interface IJobApplicationCompensationOffer {
  base_salary?: number;
  bonus_amount?: number;
  equity_value?: number;
  equity_notes?: string;
  sign_on_bonus?: number;
  total_comp?: number;
  currency?: string;
  pay_period?: PayPeriod;
  benefits_notes?: string;
  received_at?: string;
  decision_deadline?: string;
}
