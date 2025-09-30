import { IsString, IsNumber, IsOptional, IsBoolean, IsArray, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSubscriptionPlanDto {
  @ApiProperty({ description: 'Name of the subscription plan' })
  @IsString()
  planName: string;

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

  @ApiProperty({ description: 'LemonSqueezy variant ID for this plan' })
  @IsString()
  lemonSqueezyVariantId: string;

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
  billingCycle?: string;
}

export class UpdateSubscriptionPlanDto {
  @ApiPropertyOptional({ description: 'Name of the subscription plan' })
  @IsOptional()
  @IsString()
  planName?: string;

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

  @ApiPropertyOptional({ description: 'LemonSqueezy variant ID for this plan' })
  @IsOptional()
  @IsString()
  lemonSqueezyVariantId?: string;

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
  billingCycle?: string;

  @ApiPropertyOptional({ description: 'Whether the plan is active' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SubscriptionPlanResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  planName: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  price: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  lemonSqueezyVariantId: string;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty({ type: [String] })
  features: string[];

  @ApiProperty()
  billingCycle: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}