import {
  IsArray,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BatchJobItemDto {
  @ApiProperty({ example: 'Senior Frontend Engineer' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  jobPosition: string;

  @ApiProperty({ example: 'Google' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  companyName: string;

  @ApiProperty({ example: 'We are looking for a Senior Frontend Engineer...' })
  @IsString()
  @MinLength(20)
  jobDescription: string;
}

export class BatchGenerateDto {
  @ApiProperty({ type: [BatchJobItemDto], minItems: 2, maxItems: 10 })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @Type(() => BatchJobItemDto)
  jobs: BatchJobItemDto[];

  @ApiProperty({ example: 'template-uuid' })
  @IsString()
  templateId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resumeId?: string;
}

export interface BatchJobResult {
  jobPosition: string;
  companyName: string;
  status: 'success' | 'failed';
  resumeGenerationId?: string;
  pdfContent?: string;
  filename?: string;
  optimizationConfidence?: number;
  keywordsAdded?: number;
  error?: string;
}

export interface BatchGenerateResponse {
  batchId: string;
  results: BatchJobResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    totalProcessingTimeMs: number;
  };
}
