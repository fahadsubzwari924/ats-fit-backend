import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { ResumeGeneration } from './resume-generations.entity';
import { AtsMatchHistory } from './ats-match-history.entity';

export enum ApplicationStatus {
  APPLIED = 'applied',
  SCREENING = 'screening',
  TECHNICAL_ROUND = 'technical_round',
  INTERVIEWED = 'interviewed',
  OFFER_RECEIVED = 'offer_received',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  WITHDRAWN = 'withdrawn',
}

export enum ApplicationSource {
  DIRECT_APPLY = 'direct_apply',
  TAILORED_RESUME = 'tailored_resume',
}

@Entity({ name: 'job_applications' })
@Index(['user_id', 'status', 'created_at'])
@Index(['user_id', 'company_name'])
@Index(['user_id', 'application_deadline'])
@Index(['status', 'created_at'])
export class JobApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  user_id: string;

  @Column({ nullable: true })
  guest_id: string;

  // Job Details
  @Column({ type: 'varchar', length: 200 })
  company_name: string;

  @Column({ type: 'varchar', length: 300 })
  job_position: string;

  @Column({ type: 'text' })
  job_description: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  job_url: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  job_location: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  current_salary: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  expected_salary: number;

  // Application Status & Tracking
  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.APPLIED,
  })
  status: ApplicationStatus;

  @Column({
    type: 'enum',
    enum: ApplicationSource,
  })
  application_source: ApplicationSource;

  @Column({ type: 'timestamp', nullable: true })
  application_deadline: Date;

  @Column({ type: 'timestamp', nullable: true })
  applied_at: Date;

  // ATS & Resume Data
  @Column({ type: 'float', nullable: true })
  ats_score: number;

  @Column({ type: 'jsonb', nullable: true })
  ats_analysis: any; // Store detailed ATS analysis

  @Column({ type: 'varchar', nullable: true })
  ats_match_history_id: string; // Reference to ATS match history

  @Column({ type: 'uuid', nullable: true })
  resume_generation_id: string; // Reference to generated resume if applicable

  @Column({ type: 'text', nullable: true })
  resume_content: string; // Store the resume content used for this application

  // Additional Tracking Fields
  @Column({ type: 'text', nullable: true })
  cover_letter: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  contact_phone: string;

  // Interview & Follow-up Tracking
  @Column({ type: 'timestamp', nullable: true })
  interview_scheduled_at: Date;

  @Column({ type: 'text', nullable: true })
  interview_notes: string;

  @Column({ type: 'timestamp', nullable: true })
  follow_up_date: Date;

  @Column({ type: 'text', nullable: true })
  rejection_reason: string;

  // Metadata for analytics and future features
  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    skills_matched?: string[];
    skills_missing?: string[];
    application_method?: string; // online, email, in-person, etc.
    referral_source?: string;
    response_time?: number; // days to hear back
    interview_rounds?: number;
    job_board_source?: string; // LinkedIn, Indeed, etc.
    [key: string]: any;
  };

  // System Fields
  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => ResumeGeneration, { nullable: true })
  @JoinColumn({ name: 'resume_generation_id' })
  resume_generation: ResumeGeneration;

  @ManyToOne(() => AtsMatchHistory, { nullable: true })
  @JoinColumn({ name: 'ats_match_history_id' })
  ats_match_history: AtsMatchHistory;
}
