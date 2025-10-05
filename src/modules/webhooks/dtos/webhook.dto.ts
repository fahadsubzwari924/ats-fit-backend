import { IsOptional, IsString, IsObject, IsNumber, IsBoolean } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class WebhookMetaDto {
  @ApiPropertyOptional({ description: 'Whether the webhook is in test mode' })
  @IsOptional()
  @IsBoolean()
  test_mode?: boolean;

  @ApiPropertyOptional({ description: 'The name of the webhook event' })
  @IsOptional()
  @IsString()
  event_name?: string;

  @ApiPropertyOptional({ description: 'Custom data attached to the webhook' })
  @IsOptional()
  @IsObject()
  custom_data?: Record<string, any>;

  @ApiPropertyOptional({ description: 'The webhook ID' })
  @IsOptional()
  @IsString()
  webhook_id?: string;
}

export class WebhookAttributesDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  store_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  customer_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  order_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  order_item_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  product_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  variant_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  product_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  variant_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  user_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  user_email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status_formatted?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  card_brand?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  card_last_four?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  payment_processor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  pause?: any;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  cancelled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  trial_ends_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  billing_anchor?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  first_subscription_item?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  urls?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  renews_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ends_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  created_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  updated_at?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  test_mode?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  total?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  subtotal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  total_usd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  custom_data?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  checkout_data?: Record<string, any>;
}

export class WebhookDataDto {
  @ApiPropertyOptional({ description: 'The type of the resource' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'The ID of the resource' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({ description: 'The attributes of the resource' })
  @IsOptional()
  @IsObject()
  attributes?: WebhookAttributesDto;

  @ApiPropertyOptional({ description: 'The relationships of the resource' })
  @IsOptional()
  @IsObject()
  relationships?: Record<string, any>;

  @ApiPropertyOptional({ description: 'The links of the resource' })
  @IsOptional()
  @IsObject()
  links?: Record<string, any>;
}

export class WebhookEventDto {
  @ApiPropertyOptional({ description: 'The metadata of the webhook event' })
  @IsOptional()
  @IsObject()
  meta?: WebhookMetaDto;

  @ApiPropertyOptional({ description: 'The data payload of the webhook event' })
  @IsOptional()
  @IsObject()
  data?: WebhookDataDto;
}