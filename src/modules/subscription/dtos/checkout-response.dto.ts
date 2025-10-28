import { ApiProperty } from '@nestjs/swagger';

export class CheckoutResponseDto {
  @ApiProperty({
    description: 'The URL to redirect the user to complete payment',
    example: 'https://checkout.lemonsqueezy.com/...',
  })
  checkoutUrl: string;

  @ApiProperty({
    description: 'Instructions for the frontend',
    example: 'Redirect user to checkoutUrl to complete payment',
  })
  message: string;

  @ApiProperty({
    description: 'Success status',
    example: true,
  })
  success: boolean;
}

export class SubscriptionStatusDto {
  @ApiProperty({
    description: 'Subscription ID',
    example: 'sub_12345',
  })
  id: string;

  @ApiProperty({
    description: 'Subscription status',
    example: 'active',
  })
  status: string;

  @ApiProperty({
    description: 'Plan ID',
    example: 'plan_premium',
  })
  planId: string;

  @ApiProperty({
    description: 'Whether subscription is active',
    example: true,
  })
  isActive: boolean;

  @ApiProperty({
    description: 'Subscription start date',
  })
  startsAt: Date;

  @ApiProperty({
    description: 'Subscription end date',
  })
  endsAt: Date;

  @ApiProperty({
    description: 'Monthly/yearly amount',
    example: 29.99,
  })
  amount: number;

  @ApiProperty({
    description: 'Currency code',
    example: 'USD',
  })
  currency: string;
}
