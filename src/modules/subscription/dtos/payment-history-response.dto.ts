import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus, PaymentType, Currency } from '../enums/payment.enum';

export class PaymentHistoryResponseDto {
  @ApiProperty({
    description: 'Payment history unique identifier',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  id: string;

  @ApiProperty({
    description: 'Payment gateway transaction identifier',
    example: 'txn_123456789',
  })
  payment_gateway_transaction_id: string;

  @ApiProperty({
    description: 'Payment status',
    enum: PaymentStatus,
    example: PaymentStatus.SUCCESS,
  })
  status: PaymentStatus;

  @ApiProperty({
    description: 'Payment type',
    enum: PaymentType,
    example: PaymentType.SUBSCRIPTION,
  })
  payment_type: PaymentType;

  @ApiPropertyOptional({
    description: 'Payment gateway event name',
    example: 'order_created',
  })
  event_name?: string;

  @ApiProperty({
    description: 'Payment amount',
    example: 29.99,
  })
  amount: number;

  @ApiProperty({
    description: 'Payment currency',
    enum: Currency,
    example: Currency.USD,
  })
  currency: Currency;

  @ApiPropertyOptional({
    description: 'Customer email address',
    example: 'user@example.com',
  })
  customer_email?: string;

  @ApiProperty({
    description: 'Whether the payment was made in test mode',
    example: false,
  })
  is_test_mode: boolean;

  @ApiProperty({
    description: 'Whether the payment has been processed',
    example: true,
  })
  is_processed: boolean;

  @ApiPropertyOptional({
    description: 'Subscription plan information',
  })
  subscription_plan?: {
    id: string;
    plan_name: string;
    price: number;
    currency: Currency;
  };

  @ApiPropertyOptional({
    description: 'Additional metadata',
  })
  metadata?: Record<string, any>;

  @ApiProperty({
    description: 'Payment creation timestamp',
    example: '2025-11-03T10:30:00.000Z',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Payment last update timestamp',
    example: '2025-11-03T10:30:00.000Z',
  })
  updated_at: Date;
}
