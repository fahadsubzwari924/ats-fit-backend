import { IsNotEmpty, IsString, IsUUID, registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';


// Specific DTOs for different use cases - these extend the base and add specific validation
export class SubscriptionIdParamDto {
  @ApiProperty({
    description: 'Subscription ID',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsNotEmpty({ message: 'Subscription ID is required' })
  @IsString({ message: 'Subscription ID must be a string' })
  @IsUUID('4', { message: 'Subscription ID must be a valid UUID' })
  @Transform(({ value }) => value?.trim())
  id: string;
}

export class UserIdParamDto {
  @ApiProperty({
    description: 'User ID',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsNotEmpty({ message: 'User ID is required' })
  @IsString({ message: 'User ID must be a string' })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  @Transform(({ value }) => value?.trim())
  userId: string;
}

export class PlanIdParamDto {
  @ApiProperty({
    description: 'Plan ID',
    example: '123e4567-e89b-12d3-a456-426614174000'
  })
  @IsNotEmpty({ message: 'Plan ID is required' })
  @IsString({ message: 'Plan ID must be a string' })
  @IsUUID('4', { message: 'Plan ID must be valid UUID' })
  @Transform(({ value }) => value?.trim())
  id: string;
}