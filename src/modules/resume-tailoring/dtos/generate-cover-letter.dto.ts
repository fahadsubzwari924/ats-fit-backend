import { IsString, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GenerateCoverLetterDto {
  @ApiPropertyOptional({
    description: 'Resume generation ID for context reuse',
  })
  @IsOptional()
  @IsString()
  resumeGenerationId?: string;

  @ApiPropertyOptional({ description: 'Job position title (standalone mode)' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  jobPosition?: string;

  @ApiPropertyOptional({ description: 'Company name (standalone mode)' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  companyName?: string;

  @ApiPropertyOptional({ description: 'Job description (standalone mode)' })
  @IsOptional()
  @IsString()
  @MinLength(20)
  jobDescription?: string;
}
