import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BATCH_V2_MAX_JOBS } from '../constants/batch-tailoring-v2.constants';

export class EnqueueBatchV2JobDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  jobPosition: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  companyName: string;

  @ApiProperty()
  @IsString()
  @MinLength(20)
  jobDescription: string;
}

export class EnqueueBatchV2Dto {
  @ApiProperty({ type: [EnqueueBatchV2JobDto], maxItems: BATCH_V2_MAX_JOBS })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BATCH_V2_MAX_JOBS)
  @ValidateNested({ each: true })
  @Type(() => EnqueueBatchV2JobDto)
  jobs: EnqueueBatchV2JobDto[];

  @ApiProperty()
  @IsUUID()
  templateId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  resumeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acknowledgeLowFit?: boolean;
}

export class EnqueueBatchV2ResponseDto {
  @ApiProperty()
  batchId: string;

  @ApiProperty()
  totalJobs: number;
}
