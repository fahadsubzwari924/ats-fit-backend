export type JobApplicationContactRole =
  | 'recruiter'
  | 'hiring_manager'
  | 'interviewer'
  | 'referrer'
  | 'other';

export interface IJobApplicationContact {
  role: JobApplicationContactRole;
  name: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  notes?: string;
}
