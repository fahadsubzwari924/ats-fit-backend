import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Individual question response
 */
export class QuestionResponseDto {
  @ApiProperty({
    description: 'ID of the question being answered',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID(4, { message: 'Question ID must be a valid UUID' })
  @IsNotEmpty()
  questionId: string;

  @ApiProperty({
    description: 'User response to the question (factual information)',
    example:
      'The feature served 50,000 daily active users and increased engagement by 35% over 6 months',
    maxLength: 1000,
  })
  @IsString()
  @IsNotEmpty({ message: 'Response cannot be empty' })
  @MaxLength(1000, {
    message: 'Response cannot exceed 1000 characters',
  })
  response: string;
}

/**
 * DTO for submitting all question responses
 * Step 2: User provides answers to all generated questions
 */
export class SubmitQuestionResponsesDto {
  @ApiProperty({
    description: 'Tailoring session ID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID(4, { message: 'Session ID must be a valid UUID' })
  @IsNotEmpty()
  sessionId: string;

  @ApiProperty({
    description: 'Array of question responses',
    type: [QuestionResponseDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionResponseDto)
  responses: QuestionResponseDto[];
}
