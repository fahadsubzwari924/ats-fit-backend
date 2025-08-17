import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsEnum,
  IsUrl,
  IsDateString,
  IsNumber,
  Min,
  Max,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TrimString } from '../../../shared/utils/transformers';
import {
  ApplicationStatus,
  ApplicationSource,
} from '../../../database/entities/job-application.entity';

// DTO for creating job application after ATS analysis
export class CreateJobApplicationDto {
  @IsEnum(ApplicationSource, {
    message:
      'Application source must be either direct_apply or tailored_resume',
  })
  application_source: ApplicationSource;

  @IsString({ message: 'Company name must be a string' })
  @IsNotEmpty({ message: 'Company name is required' })
  @TrimString()
  company_name: string;

  @IsString({ message: 'Job position must be a string' })
  @IsNotEmpty({ message: 'Job position is required' })
  @TrimString()
  job_position: string;

  @IsString({ message: 'Job description must be a string' })
  @IsNotEmpty({ message: 'Job description is required' })
  @TrimString()
  job_description: string;

  @IsOptional()
  @IsString()
  ats_match_history_id?: string;

  @IsOptional()
  @IsString()
  resume_generation_id?: string;

  @IsOptional()
  @IsNumber({}, { message: 'ATS score must be a number' })
  @Min(0, { message: 'ATS score must be at least 0' })
  @Max(100, { message: 'ATS score must be at most 100' })
  ats_score?: number;

  @IsOptional()
  @IsObject()
  ats_analysis?: any;

  @IsOptional()
  @IsString()
  resume_content?: string;

  @IsOptional()
  @IsString()
  @IsUrl({}, { message: 'Job URL must be a valid URL' })
  job_url?: string;

  @IsOptional()
  @IsString()
  job_location?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Minimum salary must be a number' })
  @Min(0, { message: 'Minimum salary must be at least 0' })
  current_salary?: number;

  @IsOptional()
  @IsNumber({}, { message: 'Maximum salary must be a number' })
  @Min(0, { message: 'Maximum salary must be at least 0' })
  expected_salary?: number;

  @IsOptional()
  @IsString()
  @MaxLength(5000, {
    message: 'Cover letter is too long (maximum 5,000 characters)',
  })
  cover_letter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, {
    message: 'Notes are too long (maximum 2,000 characters)',
  })
  notes?: string;

  @IsOptional()
  @IsObject()
  metadata?: any;
}

// DTO for updating job application
export class UpdateJobApplicationDto {
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @IsDateString({}, { message: 'Applied date must be a valid date' })
  applied_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, {
    message: 'Cover letter is too long (maximum 5,000 characters)',
  })
  cover_letter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, {
    message: 'Notes are too long (maximum 2,000 characters)',
  })
  notes?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Interview date must be a valid date' })
  interview_scheduled_at?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, {
    message: 'Interview notes are too long (maximum 2,000 characters)',
  })
  interview_notes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, {
    message: 'Rejection reason is too long (maximum 1,000 characters)',
  })
  rejection_reason?: string;

  @IsOptional()
  @IsObject()
  metadata?: any;
}

// DTO for querying job applications
export class JobApplicationQueryDto {
  @ApiPropertyOptional({
    description: 'Application status filter',
    enum: ApplicationStatus,
  })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({
    description: 'Company name filter',
  })
  @IsOptional()
  @IsString()
  company_name?: string;

  @ApiPropertyOptional({
    description: 'Number of records to return',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Limit must be a number' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(100, { message: 'Limit must be at most 100' })
  limit?: number;

  @ApiPropertyOptional({
    description: 'Number of records to skip',
    default: 0,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'Offset must be a number' })
  @Min(0, { message: 'Offset must be at least 0' })
  offset?: number;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['created_at', 'updated_at', 'company_name', 'status', 'priority'],
    default: 'created_at',
  })
  @IsOptional()
  @IsString()
  sort_by?: string;

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsOptional()
  @IsString()
  sort_order?: 'ASC' | 'DESC';
}
