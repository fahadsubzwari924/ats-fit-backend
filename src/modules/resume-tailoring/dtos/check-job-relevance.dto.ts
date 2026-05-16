import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * Request body for the lightweight `POST /resume-tailoring/relevance` endpoint.
 *
 * Subset of `GenerateTailoredResumeDto` with the same job + company + JD
 * fields, but no `templateId` (template choice happens after the user has
 * reviewed fit, so it isn't available yet) and no `acknowledgeLowFit`
 * (relevance check never blocks — it just reports).
 */
export class CheckJobRelevanceDto {
  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  @Transform(
    ({ value }) => (typeof value === 'string' ? value.trim() : value) as string,
  )
  jobPosition: string;

  @ApiProperty({ minLength: 50, maxLength: 15000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(50)
  @MaxLength(15000)
  @Transform(
    ({ value }) => (typeof value === 'string' ? value.trim() : value) as string,
  )
  jobDescription: string;

  @ApiProperty({ minLength: 2, maxLength: 100 })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  @Transform(
    ({ value }) => (typeof value === 'string' ? value.trim() : value) as string,
  )
  companyName: string;

  @ApiPropertyOptional({
    description:
      'Optional resume ID. If omitted, latest active resume is used.',
  })
  @IsOptional()
  @IsUUID(4)
  resumeId?: string;
}
