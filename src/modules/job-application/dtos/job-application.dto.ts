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
import { TrimString } from '../../../shared/utils/transformers';
import {
  ApplicationStatus,
  ApplicationSource,
} from '../../../database/entities/job-application.entity';

export { JobApplicationQueryDto } from './job-application-query.dto';

// DTO for creating job application records
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
  resume_generation_id?: string;

  @ApiPropertyOptional({
    description:
      'When the candidate applied (ISO 8601). Omit to use server default for tailored_resume (now).',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Applied date must be a valid ISO date string' })
  applied_at?: string;

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

  @ApiPropertyOptional({
    description: 'Planned follow-up date (ISO 8601)',
    example: '2026-04-10T12:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Follow-up date must be a valid date' })
  follow_up_date?: string;

  @ApiPropertyOptional({
    description: 'Contact phone for this application',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contact_phone?: string;

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
