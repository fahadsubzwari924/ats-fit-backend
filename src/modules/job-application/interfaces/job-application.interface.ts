import {
  ApplicationStatus,
  ApplicationSource,
  JobApplication,
} from '../../../database/entities/job-application.entity';
import { JobBoardSource } from '../enums/job-board-source.enum';
import { AppliedVia } from '../enums/applied-via.enum';
import { EmploymentType } from '../enums/employment-type.enum';
import { WorkMode } from '../enums/work-mode.enum';
import { PayPeriod } from '../enums/pay-period.enum';
import { ApplicationPriority } from '../enums/application-priority.enum';
import { RejectionStage } from '../enums/rejection-stage.enum';
import type { IJobApplicationContact } from './job-application-contact.interface';
import type { IJobApplicationAttachment } from './job-application-attachment.interface';
import type { IJobApplicationCompensationOffer } from './job-application-compensation-offer.interface';

export interface IJobApplicationMetadata {
  skills_matched?: string[];
  skills_missing?: string[];
  [key: string]: any;
}

export interface ICreateJobApplication {
  user_id?: string;
  application_source: ApplicationSource;
  status?: ApplicationStatus;
  company_name: string;
  job_position: string;
  job_description?: string;
  job_url?: string;
  job_location?: string;
  employment_type?: EmploymentType;
  work_mode?: WorkMode;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  pay_period?: PayPeriod;
  salary_negotiable?: boolean;
  job_board_source?: JobBoardSource;
  applied_via?: AppliedVia;
  priority?: ApplicationPriority;
  tags?: string[];
  applied_at?: string;
  application_deadline?: Date | string;
  decision_deadline?: Date | string;
  next_action?: string;
  resume_generation_id?: string;
  resume_content?: string;
  recruiter_name?: string;
  recruiter_email?: string;
  recruiter_phone?: string;
  hiring_manager_name?: string;
  hiring_manager_email?: string;
  contact_phone?: string;
  contacts?: IJobApplicationContact[];
  cover_letter?: string;
  notes?: string;
  attachments?: IJobApplicationAttachment[];
  metadata?: IJobApplicationMetadata;
}

export interface IUpdateJobApplication {
  company_name?: string;
  job_position?: string;
  job_description?: string;
  job_url?: string;
  job_location?: string;
  employment_type?: EmploymentType;
  work_mode?: WorkMode;
  salary_min?: number;
  salary_max?: number;
  salary_currency?: string;
  pay_period?: PayPeriod;
  salary_negotiable?: boolean;
  status?: ApplicationStatus;
  job_board_source?: JobBoardSource;
  applied_via?: AppliedVia;
  priority?: ApplicationPriority;
  tags?: string[];
  applied_at?: Date | string;
  application_deadline?: Date | string;
  decision_deadline?: Date | string;
  next_action?: string;
  recruiter_name?: string;
  recruiter_email?: string;
  recruiter_phone?: string;
  hiring_manager_name?: string;
  hiring_manager_email?: string;
  contact_phone?: string;
  contacts?: IJobApplicationContact[];
  cover_letter?: string;
  notes?: string;
  interview_scheduled_at?: Date | string;
  interview_notes?: string;
  follow_up_date?: Date | string;
  rejection_stage?: RejectionStage;
  rejection_reason?: string;
  rejection_feedback_received?: boolean;
  compensation_offer?: IJobApplicationCompensationOffer;
  attachments?: IJobApplicationAttachment[];
  metadata?: IJobApplicationMetadata;
}

export interface IJobApplicationQuery {
  user_id?: string;
  status?: ApplicationStatus;
  statuses?: ApplicationStatus[];
  company_name?: string;
  q?: string;
  job_board_source?: JobBoardSource;
  work_mode?: WorkMode;
  employment_type?: EmploymentType;
  priority?: ApplicationPriority;
  tag?: string;
  applied_at_from?: string;
  applied_at_to?: string;
  deadline_from?: string;
  deadline_to?: string;
  follow_up_from?: string;
  follow_up_to?: string;
  decision_deadline_from?: string;
  decision_deadline_to?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: 'ASC' | 'DESC';
  fields?: string[];
}

export interface IJobApplicationStats {
  total_applications: number;
  applications_by_status: Record<ApplicationStatus, number>;
  response_rate: number;
  interview_rate: number;
  success_rate: number;
  top_companies: Array<{ company_name: string; application_count: number }>;
  monthly_trend: Array<{ month: string; count: number }>;
}

export interface IJobApplicationWithRelations extends JobApplication {
  resumeGeneration?: {
    id: string;
    template_id: string;
    tailored_content: any;
  };
}
