import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsNumber,
  Min,
  Max,
  IsArray,
  IsIn,
  MaxLength,
  Validate,
  Allow,
} from 'class-validator';
import { ApplicationStatus } from '../../../database/entities/job-application.entity';
import { JobApplicationQueryDateRangesConstraint } from './job-application-query-date-ranges.constraint';

const JOB_APPLICATION_QUERY_SORT_FIELDS = [
  'created_at',
  'updated_at',
  'company_name',
  'job_position',
  'status',
  'applied_at',
  'application_deadline',
  'follow_up_date',
  'ats_score',
] as const;

export class JobApplicationQueryDto {
  @ApiHideProperty()
  @Allow()
  @Validate(JobApplicationQueryDateRangesConstraint, [], { always: true })
  _dateRangeInvariant?: undefined;

  @ApiPropertyOptional({
    description: 'Application status filter',
    enum: ApplicationStatus,
  })
  @IsOptional()
  @IsEnum(ApplicationStatus)
  status?: ApplicationStatus;

  @ApiPropertyOptional({
    description: 'Filter by multiple statuses (comma-separated)',
    isArray: true,
    enum: ApplicationStatus,
  })
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    if (Array.isArray(value)) {
      return value
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  })
  @IsOptional()
  @IsArray()
  @IsEnum(ApplicationStatus, { each: true })
  statuses?: ApplicationStatus[];

  @ApiPropertyOptional({ description: 'Company name filter' })
  @IsOptional()
  @IsString()
  company_name?: string;

  @ApiPropertyOptional({
    description:
      'Case-insensitive search across company name and job title (ILIKE on company_name and job_position).',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'Applied on or after (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  applied_at_from?: string;

  @ApiPropertyOptional({ description: 'Applied on or before (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  applied_at_to?: string;

  @ApiPropertyOptional({ description: 'Deadline on or after (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  deadline_from?: string;

  @ApiPropertyOptional({ description: 'Deadline on or before (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  deadline_to?: string;

  @ApiPropertyOptional({ description: 'Follow-up on or after (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  follow_up_from?: string;

  @ApiPropertyOptional({ description: 'Follow-up on or before (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  follow_up_to?: string;

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
    enum: [...JOB_APPLICATION_QUERY_SORT_FIELDS],
    default: 'created_at',
  })
  @IsOptional()
  @IsIn([...JOB_APPLICATION_QUERY_SORT_FIELDS])
  sort_by?: (typeof JOB_APPLICATION_QUERY_SORT_FIELDS)[number];

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['ASC', 'DESC'],
    default: 'DESC',
  })
  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sort_order?: 'ASC' | 'DESC';
}
