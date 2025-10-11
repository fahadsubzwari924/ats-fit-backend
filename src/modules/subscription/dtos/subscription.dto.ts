import { IsNotEmpty, IsString, IsOptional, IsObject, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSubscriptionDto {
  @ApiProperty({
    description: 'The ID of the subscription plan (External variant ID)',
    example: 'variant_12345'
  })
  @IsNotEmpty()
  @IsString()
  plan_id: string;

  @ApiProperty({
    description: 'Additional metadata for the subscription',
    required: false,
    example: {
      email: 'user@example.com',
      name: 'John Doe'
    }
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateSubscriptionDto {
  @ApiProperty({
    description: 'The ID of the subscription to update',
    example: 'sub_12345'
  })
  @IsNotEmpty()
  @IsUUID()
  subscription_id: string;

  @ApiProperty({
    description: 'Additional metadata for the subscription',
    required: false
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}