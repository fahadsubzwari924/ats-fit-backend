import {
  ApplicationStatus,
  ApplicationSource,
  JobApplication,
} from '../../../database/entities/job-application.entity';
import { AtsAnalysis } from './ats-analysis.interface';

export interface IJobApplicationMetadata {
  skills_matched?: string[];
  skills_missing?: string[];
  [key: string]: any;
}

export interface IJobApplicationAnalysis {
  ats_score: number;
  ats_analysis: any;
  ats_match_history_id: string;
  resume_content: string;
  suggestions: string[];
  matched_skills: string[];
  missing_skills: string[];
}

export interface ICreateJobApplication {
  user_id?: string;
  guest_id?: string;
  company_name: string;
  job_position: string;
  job_description: string;
  application_source: ApplicationSource;
  ats_match_history_id?: string;
  resume_generation_id?: string;
  ats_score?: number;
  ats_analysis?: AtsAnalysis;
  resume_content?: string;
  job_url?: string;
  job_location?: string;
  current_salary?: number;
  expected_salary?: number;
  application_deadline?: Date;
  cover_letter?: string;
  notes?: string;
  contact_phone?: string;
  metadata?: IJobApplicationMetadata;
}

export interface IUpdateJobApplication {
  status?: ApplicationStatus;
  applied_at?: Date;
  cover_letter?: string;
  notes?: string;
  contact_phone?: string;
  interview_scheduled_at?: Date;
  interview_notes?: string;
  follow_up_date?: Date;
  rejection_reason?: string;
  metadata?: IJobApplicationMetadata;
}

export interface IJobApplicationQuery {
  user_id?: string;
  guest_id?: string;
  status?: ApplicationStatus;
  company_name?: string;
  limit?: number;
  offset?: number;
  sort_by?: string;
  sort_order?: 'ASC' | 'DESC';
  fields?: string[]; // Add field selection support
}

export interface IJobApplicationStats {
  total_applications: number;
  applications_by_status: Record<ApplicationStatus, number>;
  average_ats_score: number;
  response_rate: number;
  interview_rate: number;
  success_rate: number;
  top_companies: Array<{
    company_name: string;
    application_count: number;
  }>;
  monthly_trend: Array<{
    month: string;
    count: number;
  }>;
}

export interface IJobApplicationWithRelations extends JobApplication {
  atsMatchHistory?: {
    id: string;
    ats_score: number;
    analysis: any;
  };
  resumeGeneration?: {
    id: string;
    template_id: string;
    tailored_content: any;
  };
}
