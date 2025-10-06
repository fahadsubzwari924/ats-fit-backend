import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  MinLength,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class GenerateTailoredResumeDto {
  @ApiProperty({
    description: 'Job position title/name',
    example: 'Senior Full Stack Developer',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2, {
    message: 'Job position must be at least 2 characters long',
  })
  @MaxLength(100, {
    message: 'Job position cannot exceed 100 characters',
  })
  @Transform(
    ({ value }) => (typeof value === 'string' ? value.trim() : value) as string,
  )
  jobPosition: string;

  @ApiProperty({
    description:
      'Complete job description with requirements and responsibilities',
    example:
      'We are looking for a Senior Full Stack Developer with 5+ years experience...',
    minLength: 50,
    maxLength: 15000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(50, {
    message: 'Job description must be at least 50 characters long',
  })
  @MaxLength(15000, {
    message: 'Job description cannot exceed 15,000 characters',
  })
  @Transform(
    ({ value }) => (typeof value === 'string' ? value.trim() : value) as string,
  )
  jobDescription: string;

  @ApiProperty({
    description: 'Company name',
    example: 'Google Inc.',
    minLength: 2,
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2, {
    message: 'Company name must be at least 2 characters long',
  })
  @MaxLength(100, {
    message: 'Company name cannot exceed 100 characters',
  })
  @Transform(
    ({ value }) => (typeof value === 'string' ? value.trim() : value) as string,
  )
  companyName: string;

  @ApiProperty({
    description: 'ID of the pre-defined resume template',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID(4, { message: 'Template ID must be a valid UUID' })
  @IsNotEmpty()
  templateId: string;

  @ApiPropertyOptional({
    description:
      'Optional resume ID for registered users. If not provided, latest resume will be used for registered users',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsOptional()
  @IsUUID(4, { message: 'Resume ID must be a valid UUID' })
  resumeId?: string;
}
