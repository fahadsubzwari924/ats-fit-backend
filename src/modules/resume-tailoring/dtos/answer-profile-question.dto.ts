import {
  IsString,
  IsNotEmpty,
  IsUUID,
  MaxLength,
  IsOptional,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for saving a single profile question answer (auto-save on blur).
 * - response: non-empty string = answered
 * - response: null = user skipped (resolved; no facts added; not shown as pending again)
 * - response: "" or omitted = treat as not answered (clears any previous text)
 */
export class AnswerProfileQuestionDto {
  @ApiProperty({
    description: 'ID of the profile question',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID(4, { message: 'Question ID must be a valid UUID' })
  @IsNotEmpty()
  questionId: string;

  @ApiPropertyOptional({
    description: 'User response (null if skipped)',
    example: 'Reduced latency by 40% for 2M daily requests',
    maxLength: 1000,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, {
    message: 'Response cannot exceed 1000 characters',
  })
  response?: string | null;
}
