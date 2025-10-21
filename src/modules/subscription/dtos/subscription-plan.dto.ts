import { IsString, IsNumber, IsOptional, IsBoolean, IsArray, IsIn, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle } from '../enums';

export class CreateSubscriptionPlanDto {
  @ApiProperty({ description: 'Name of the subscription plan' })
  @IsString()
  plan_name: string;

  @ApiProperty({ description: 'Description of what the plan includes' })
  @IsString()
  description: string;

  @ApiProperty({ description: 'Price of the subscription plan' })
  @IsNumber()
  price: number;

  @ApiPropertyOptional({ description: 'Currency code (default: USD)' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ description: 'External payment gateway variant ID for this plan' })
  @IsString()
  external_payment_gateway_variant_id: string;

  @ApiPropertyOptional({ description: 'List of features included in the plan' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @ApiPropertyOptional({ 
    description: 'Billing cycle for the plan',
    enum: ['monthly', 'yearly', 'one-time']
  })
  @IsOptional()
  @IsString()
  @IsIn(['monthly', 'yearly', 'one-time'])
  billing_cycle?: string;
}

export class UpdateSubscriptionPlanDto {
  @ApiPropertyOptional({ description: 'Name of the subscription plan' })
  @IsOptional()
  @IsString()
  plan_name?: string;

  @ApiPropertyOptional({ description: 'Description of what the plan includes' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Price of the subscription plan' })
  @IsOptional()
  @IsNumber()
  price?: number;

  @ApiPropertyOptional({ description: 'Currency code' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'External payment gateway variant ID for this plan' })
  @IsOptional()
  @IsString()
  external_payment_gateway_variant_id?: string;

  @ApiPropertyOptional({ description: 'List of features included in the plan' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @ApiPropertyOptional({ 
    description: 'Billing cycle for the plan',
    enum: BillingCycle
  })
  @IsOptional()
  @IsEnum(BillingCycle)
  billing_cycle?: BillingCycle;

  @ApiPropertyOptional({ description: 'Whether the plan is active' })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class SubscriptionPlanResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  plan_name: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  price: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  external_payment_gateway_variant_id: string;

  @ApiProperty()
  is_active: boolean;

  @ApiProperty({ type: [String] })
  features: string[];

  @ApiProperty({ enum: BillingCycle })
  billing_cycle: BillingCycle;

  @ApiProperty()
  created_at: Date;

  @ApiProperty()
  updated_at: Date;
}