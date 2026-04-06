import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ApplicationStatus,
  ApplicationSource,
} from '../../../database/entities/job-application.entity';

export class JobApplicationResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the job application',
    example: 'uuid-string',
  })
  id: string;

  @ApiProperty({
    description: 'Company name',
    example: 'Tech Corp Inc.',
  })
  company_name: string;

  @ApiProperty({
    description: 'Job position/title',
    example: 'Senior Full Stack Developer',
  })
  job_position: string;

  @ApiProperty({
    description: 'Job description',
  })
  job_description: string;

  @ApiPropertyOptional({
    description: 'Job posting URL',
  })
  job_url?: string;

  @ApiPropertyOptional({
    description: 'Job location',
  })
  job_location?: string;

  @ApiPropertyOptional({
    description: 'Minimum salary',
  })
  current_salary?: number;

  @ApiPropertyOptional({
    description: 'Maximum salary',
  })
  expected_salary?: number;

  @ApiProperty({
    description: 'Application status',
    enum: ApplicationStatus,
  })
  status: ApplicationStatus;

  @ApiProperty({
    description: 'Application source',
    enum: ApplicationSource,
  })
  application_source: ApplicationSource;

  @ApiPropertyOptional({
    description: 'Application deadline',
  })
  application_deadline?: Date;

  @ApiPropertyOptional({
    description: 'Date when application was submitted',
  })
  applied_at?: Date;

  @ApiPropertyOptional({
    description: 'Cover letter content',
  })
  cover_letter?: string;

  @ApiPropertyOptional({
    description: 'Additional notes',
  })
  notes?: string;

  @ApiPropertyOptional({
    description: 'Contact phone number',
  })
  contact_phone?: string;

  @ApiPropertyOptional({
    description: 'Interview scheduled date',
  })
  interview_scheduled_at?: Date;

  @ApiPropertyOptional({
    description: 'Interview notes',
  })
  interview_notes?: string;

  @ApiPropertyOptional({
    description: 'Follow-up date',
  })
  follow_up_date?: Date;

  @ApiPropertyOptional({
    description: 'Rejection reason',
  })
  rejection_reason?: string;

  @ApiPropertyOptional({
    description: 'Additional metadata',
  })
  metadata?: any;

  @ApiProperty({
    description: 'Creation timestamp',
  })
  created_at: Date;

  @ApiProperty({
    description: 'Last update timestamp',
  })
  updated_at: Date;

  @ApiPropertyOptional({
    description: 'User ID (for registered users)',
  })
  user_id?: string;

  @ApiPropertyOptional({
    description: 'Guest ID (for guest users)',
  })
  guest_id?: string;
}

export class JobApplicationListResponseDto {
  @ApiProperty({
    description: 'List of job applications',
    type: [JobApplicationResponseDto],
  })
  applications: JobApplicationResponseDto[];

  @ApiProperty({
    description: 'Total number of applications',
    example: 50,
  })
  total: number;

  @ApiProperty({
    description: 'Number of applications returned',
    example: 20,
  })
  count: number;

  @ApiProperty({
    description: 'Offset used for pagination',
    example: 0,
  })
  offset: number;

  @ApiProperty({
    description: 'Limit used for pagination',
    example: 20,
  })
  limit: number;
}

export class JobApplicationStatsResponseDto {
  @ApiProperty({
    description: 'Total number of applications',
    example: 25,
  })
  total_applications: number;

  @ApiProperty({
    description: 'Applications by status',
  })
  applications_by_status: {
    [key in ApplicationStatus]: number;
  };

  @ApiProperty({
    description: 'Response rate (percentage)',
    example: 15.5,
  })
  response_rate: number;

  @ApiProperty({
    description: 'Interview rate (percentage)',
    example: 8.2,
  })
  interview_rate: number;

  @ApiProperty({
    description: 'Success rate (percentage of offers received)',
    example: 4.1,
  })
  success_rate: number;

  @ApiProperty({
    description: 'Top companies applied to',
  })
  top_companies: {
    company_name: string;
    application_count: number;
  }[];

  @ApiProperty({
    description: 'Monthly application trend',
  })
  monthly_trend: {
    month: string;
    count: number;
  }[];
}
