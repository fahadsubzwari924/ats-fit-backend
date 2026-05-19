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
  IsObject,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  IsEmail,
} from 'class-validator';
import { TrimString } from '../../../shared/utils/transformers';
import {
  ApplicationStatus,
  ApplicationSource,
} from '../../../database/entities/job-application.entity';
import { JobBoardSource } from '../enums/job-board-source.enum';
import { AppliedVia } from '../enums/applied-via.enum';
import { EmploymentType } from '../enums/employment-type.enum';
import { WorkMode } from '../enums/work-mode.enum';
import { PayPeriod } from '../enums/pay-period.enum';
import { ApplicationPriority } from '../enums/application-priority.enum';
import type { IJobApplicationContact } from '../interfaces/job-application-contact.interface';
import type { IJobApplicationAttachment } from '../interfaces/job-application-attachment.interface';
import { RejectionStage } from '../enums/rejection-stage.enum';
import type { IJobApplicationCompensationOffer } from '../interfaces/job-application-compensation-offer.interface';

export { JobApplicationQueryDto } from './job-application-query.dto';

// DTO for creating job application records
export class CreateJobApplicationDto {
  @IsEnum(ApplicationSource, {
    message:
      'Application source must be either direct_apply or tailored_resume',
  })
  application_source: ApplicationSource;

  @IsOptional()
  @IsEnum(ApplicationStatus, {
    message: 'status must be a valid ApplicationStatus',
  })
  status?: ApplicationStatus;

  @IsString({ message: 'Company name must be a string' })
  @IsNotEmpty({ message: 'Company name is required' })
  @TrimString()
  company_name: string;

  @IsString({ message: 'Job position must be a string' })
  @IsNotEmpty({ message: 'Job position is required' })
  @TrimString()
  job_position: string;

  @IsOptional()
  @IsString({ message: 'Job description must be a string' })
  @TrimString()
  job_description?: string;

  @IsOptional()
  @IsString()
  resume_generation_id?: string;

  @ApiPropertyOptional({
    description:
      'When the candidate applied (ISO 8601). Omit for wishlist/interested.',
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
  @IsEnum(EmploymentType)
  employment_type?: EmploymentType;

  @IsOptional()
  @IsEnum(WorkMode)
  work_mode?: WorkMode;

  @IsOptional()
  @IsNumber({}, { message: 'salary_min must be a number' })
  @Min(0, { message: 'salary_min must be at least 0' })
  salary_min?: number;

  @IsOptional()
  @IsNumber({}, { message: 'salary_max must be a number' })
  @Min(0, { message: 'salary_max must be at least 0' })
  salary_max?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3, { message: 'salary_currency must be a 3-letter ISO 4217 code' })
  salary_currency?: string;

  @IsOptional()
  @IsEnum(PayPeriod)
  pay_period?: PayPeriod;

  @IsOptional()
  @IsBoolean()
  salary_negotiable?: boolean;

  @IsOptional()
  @IsEnum(JobBoardSource)
  job_board_source?: JobBoardSource;

  @IsOptional()
  @IsEnum(AppliedVia)
  applied_via?: AppliedVia;

  @IsOptional()
  @IsEnum(ApplicationPriority)
  priority?: ApplicationPriority;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsDateString({}, { message: 'application_deadline must be a valid date' })
  application_deadline?: string;

  @IsOptional()
  @IsDateString({}, { message: 'decision_deadline must be a valid date' })
  decision_deadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  next_action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  recruiter_name?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  recruiter_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  recruiter_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  hiring_manager_name?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  hiring_manager_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, {
    message: 'Cover letter is too long (maximum 5,000 characters)',
  })
  cover_letter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Notes are too long (maximum 2,000 characters)' })
  notes?: string;

  @IsOptional()
  @IsArray()
  contacts?: IJobApplicationContact[];

  @IsOptional()
  @IsArray()
  attachments?: IJobApplicationAttachment[];

  @IsOptional()
  @IsObject()
  metadata?: any;
}

// DTO for updating job application
export class UpdateJobApplicationDto {
  // ── Core job (newly editable) ──────────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @TrimString()
  company_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  @TrimString()
  job_position?: string;

  @IsOptional()
  @IsString()
  @TrimString()
  job_description?: string;

  @IsOptional()
  @IsString()
  @IsUrl({}, { message: 'Job URL must be a valid URL' })
  job_url?: string;

  @IsOptional()
  @IsString()
  job_location?: string;

  @IsOptional()
  @IsEnum(EmploymentType)
  employment_type?: EmploymentType;

  @IsOptional()
  @IsEnum(WorkMode)
  work_mode?: WorkMode;

  // ── Compensation (posted) ──────────────────────────────────
  @IsOptional()
  @IsNumber({}, { message: 'salary_min must be a number' })
  @Min(0, { message: 'Minimum salary cannot be negative' })
  salary_min?: number;

  @IsOptional()
  @IsNumber({}, { message: 'salary_max must be a number' })
  @Min(0, { message: 'Maximum salary cannot be negative' })
  salary_max?: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  salary_currency?: string;

  @IsOptional()
  @IsEnum(PayPeriod)
  pay_period?: PayPeriod;

  @IsOptional()
  @IsBoolean()
  salary_negotiable?: boolean;

  // ── Pipeline ───────────────────────────────────────────────
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @IsOptional()
  @IsEnum(JobBoardSource)
  job_board_source?: JobBoardSource;

  @IsOptional()
  @IsEnum(AppliedVia)
  applied_via?: AppliedVia;

  @IsOptional()
  @IsEnum(ApplicationPriority)
  priority?: ApplicationPriority;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  tags?: string[];

  @IsOptional()
  @IsDateString({}, { message: 'Applied date must be a valid date' })
  applied_at?: string;

  @IsOptional()
  @IsDateString({}, { message: 'application_deadline must be a valid date' })
  application_deadline?: string;

  @ApiPropertyOptional({
    description: 'Planned follow-up date (ISO 8601)',
    example: '2026-04-10T12:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Follow-up date must be a valid date' })
  follow_up_date?: string;

  @IsOptional()
  @IsDateString({}, { message: 'decision_deadline must be a valid date' })
  decision_deadline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  next_action?: string;

  // ── Contacts ───────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(200)
  recruiter_name?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  recruiter_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  recruiter_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  hiring_manager_name?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  hiring_manager_email?: string;

  @ApiPropertyOptional({
    description: 'Contact phone for this application',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  contact_phone?: string;

  @IsOptional()
  @IsArray()
  contacts?: IJobApplicationContact[];

  // ── Notes / interview / follow-up ──────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(5000, {
    message: 'Cover letter is too long (maximum 5,000 characters)',
  })
  cover_letter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Notes are too long (maximum 2,000 characters)' })
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

  // ── Rejection ──────────────────────────────────────────────
  @IsOptional()
  @IsEnum(RejectionStage)
  rejection_stage?: RejectionStage;

  @IsOptional()
  @IsString()
  @MaxLength(1000, {
    message: 'Rejection reason is too long (maximum 1,000 characters)',
  })
  rejection_reason?: string;

  @IsOptional()
  @IsBoolean()
  rejection_feedback_received?: boolean;

  // ── Offer ──────────────────────────────────────────────────
  @IsOptional()
  @IsObject()
  compensation_offer?: IJobApplicationCompensationOffer;

  // ── Attachments / open metadata ────────────────────────────
  @IsOptional()
  @IsArray()
  attachments?: IJobApplicationAttachment[];

  @IsOptional()
  @IsObject()
  metadata?: any;
}
