import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { RejectionStage } from '../enums/rejection-stage.enum';
import type { IJobApplicationContact } from '../interfaces/job-application-contact.interface';
import type { IJobApplicationAttachment } from '../interfaces/job-application-attachment.interface';
import type { IJobApplicationStatusHistoryEntry } from '../interfaces/job-application-status-history.interface';
import type { IJobApplicationCompensationOffer } from '../interfaces/job-application-compensation-offer.interface';

export class JobApplicationResponseDto {
  @ApiProperty({ description: 'Unique identifier', example: 'uuid-string' })
  id: string;

  @ApiProperty({ description: 'Company name', example: 'Acme Corp' })
  company_name: string;

  @ApiProperty({
    description: 'Job position/title',
    example: 'Senior Engineer',
  })
  job_position: string;

  @ApiPropertyOptional({ description: 'Job description' })
  job_description?: string;

  @ApiPropertyOptional({ description: 'Job posting URL' })
  job_url?: string;

  @ApiPropertyOptional({ description: 'Job location' })
  job_location?: string;

  @ApiPropertyOptional({ description: 'Employment type', enum: EmploymentType })
  employment_type?: EmploymentType;

  @ApiPropertyOptional({ description: 'Work mode', enum: WorkMode })
  work_mode?: WorkMode;

  @ApiPropertyOptional({ description: 'Minimum advertised salary' })
  salary_min?: number;

  @ApiPropertyOptional({ description: 'Maximum advertised salary' })
  salary_max?: number;

  @ApiPropertyOptional({
    description: 'ISO 4217 currency code (e.g. USD, EUR)',
  })
  salary_currency?: string;

  @ApiPropertyOptional({ description: 'Pay period', enum: PayPeriod })
  pay_period?: PayPeriod;

  @ApiPropertyOptional({ description: 'Whether salary is negotiable' })
  salary_negotiable?: boolean;

  @ApiProperty({ description: 'Application status', enum: ApplicationStatus })
  status: ApplicationStatus;

  @ApiProperty({ description: 'Application source', enum: ApplicationSource })
  application_source: ApplicationSource;

  @ApiPropertyOptional({
    description: 'Job board where the role was found',
    enum: JobBoardSource,
  })
  job_board_source?: JobBoardSource;

  @ApiPropertyOptional({
    description: 'How the application was submitted',
    enum: AppliedVia,
  })
  applied_via?: AppliedVia;

  @ApiPropertyOptional({
    description: 'Application priority',
    enum: ApplicationPriority,
  })
  priority?: ApplicationPriority;

  @ApiPropertyOptional({ description: 'User-defined labels', type: [String] })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Application deadline' })
  application_deadline?: Date;

  @ApiPropertyOptional({ description: 'Date when application was submitted' })
  applied_at?: Date;

  @ApiPropertyOptional({ description: 'Offer decision deadline' })
  decision_deadline?: Date;

  @ApiPropertyOptional({
    description: 'Next planned action for this application',
  })
  next_action?: string;

  @ApiPropertyOptional({ description: 'Cover letter content' })
  cover_letter?: string;

  @ApiPropertyOptional({ description: 'Additional notes' })
  notes?: string;

  @ApiPropertyOptional({ description: 'Recruiter name' })
  recruiter_name?: string;

  @ApiPropertyOptional({ description: 'Recruiter email' })
  recruiter_email?: string;

  @ApiPropertyOptional({ description: 'Recruiter phone' })
  recruiter_phone?: string;

  @ApiPropertyOptional({ description: 'Hiring manager name' })
  hiring_manager_name?: string;

  @ApiPropertyOptional({ description: 'Hiring manager email' })
  hiring_manager_email?: string;

  @ApiPropertyOptional({ description: 'Contact phone number' })
  contact_phone?: string;

  @ApiPropertyOptional({ description: 'Extended contacts list', type: 'array' })
  contacts?: IJobApplicationContact[];

  @ApiPropertyOptional({ description: 'Interview scheduled date' })
  interview_scheduled_at?: Date;

  @ApiPropertyOptional({ description: 'Interview notes' })
  interview_notes?: string;

  @ApiPropertyOptional({ description: 'Follow-up date' })
  follow_up_date?: Date;

  @ApiPropertyOptional({
    description: 'Stage at which application was rejected',
    enum: RejectionStage,
  })
  rejection_stage?: RejectionStage;

  @ApiPropertyOptional({ description: 'Rejection reason' })
  rejection_reason?: string;

  @ApiPropertyOptional({
    description: 'Whether recruiter provided feedback on rejection',
  })
  rejection_feedback_received?: boolean;

  @ApiPropertyOptional({ description: 'Structured offer compensation details' })
  compensation_offer?: IJobApplicationCompensationOffer;

  @ApiPropertyOptional({
    description: 'Attached documents and links',
    type: 'array',
  })
  attachments?: IJobApplicationAttachment[];

  @ApiPropertyOptional({
    description: 'Status transition history',
    type: 'array',
  })
  status_history?: IJobApplicationStatusHistoryEntry[];

  @ApiPropertyOptional({ description: 'Additional metadata' })
  metadata?: any;

  @ApiProperty({ description: 'Creation timestamp' })
  created_at: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updated_at: Date;

  @ApiPropertyOptional({ description: 'User ID' })
  user_id?: string;
}

export class JobApplicationListResponseDto {
  @ApiProperty({
    description: 'List of job applications',
    type: [JobApplicationResponseDto],
  })
  applications: JobApplicationResponseDto[];

  @ApiProperty({ description: 'Total number of applications', example: 50 })
  total: number;

  @ApiProperty({ description: 'Number of applications returned', example: 20 })
  count: number;

  @ApiProperty({ description: 'Offset used for pagination', example: 0 })
  offset: number;

  @ApiProperty({ description: 'Limit used for pagination', example: 20 })
  limit: number;
}

export class JobApplicationStatsResponseDto {
  @ApiProperty({ description: 'Total number of applications', example: 25 })
  total_applications: number;

  @ApiProperty({ description: 'Applications by status' })
  applications_by_status: { [key in ApplicationStatus]: number };

  @ApiProperty({ description: 'Response rate (percentage)', example: 15.5 })
  response_rate: number;

  @ApiProperty({ description: 'Interview rate (percentage)', example: 8.2 })
  interview_rate: number;

  @ApiProperty({
    description: 'Success rate (percentage of offers received)',
    example: 4.1,
  })
  success_rate: number;

  @ApiProperty({ description: 'Top companies applied to' })
  top_companies: { company_name: string; application_count: number }[];

  @ApiProperty({ description: 'Monthly application trend' })
  monthly_trend: { month: string; count: number }[];
}
