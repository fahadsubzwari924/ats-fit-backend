import { IsNotEmpty, IsString, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WebhookEventDto {
  @ApiProperty({
    description: 'The name of the webhook event',
    example: 'subscription_created'
  })
  @IsNotEmpty()
  @IsString()
  event_name: string;

  @ApiProperty({
    description: 'The data payload of the webhook event'
  })
  @IsNotEmpty()
  @IsObject()
  data: Record<string, any>;

  @ApiProperty({
    description: 'The signature of the webhook request'
  })
  @IsNotEmpty()
  @IsString()
  signature: string;
}