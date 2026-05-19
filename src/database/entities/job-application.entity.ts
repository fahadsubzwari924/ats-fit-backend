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
import { JobBoardSource } from '../../modules/job-application/enums/job-board-source.enum';
import { AppliedVia } from '../../modules/job-application/enums/applied-via.enum';
import { EmploymentType } from '../../modules/job-application/enums/employment-type.enum';
import { WorkMode } from '../../modules/job-application/enums/work-mode.enum';
import { PayPeriod } from '../../modules/job-application/enums/pay-period.enum';
import { ApplicationPriority } from '../../modules/job-application/enums/application-priority.enum';
import { RejectionStage } from '../../modules/job-application/enums/rejection-stage.enum';
import type { IJobApplicationContact } from '../../modules/job-application/interfaces/job-application-contact.interface';
import type { IJobApplicationAttachment } from '../../modules/job-application/interfaces/job-application-attachment.interface';
import type { IJobApplicationStatusHistoryEntry } from '../../modules/job-application/interfaces/job-application-status-history.interface';
import type { IJobApplicationCompensationOffer } from '../../modules/job-application/interfaces/job-application-compensation-offer.interface';
import { decimalToNumberTransformer } from '../../shared/utils/decimal-numeric.transformer';

export enum ApplicationStatus {
  WISHLIST = 'wishlist',
  INTERESTED = 'interested',
  APPLIED = 'applied',
  SCREENING = 'screening',
  TECHNICAL_ROUND = 'technical_round',
  INTERVIEWED = 'interviewed',
  OFFER_RECEIVED = 'offer_received',
  ACCEPTED = 'accepted',
  OFFER_DECLINED = 'offer_declined',
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
@Index(['user_id', 'priority'])
@Index(['user_id', 'work_mode'])
@Index(['user_id', 'job_board_source'])
@Index(['user_id', 'decision_deadline'])
@Index(['status', 'created_at'])
export class JobApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  user_id: string;

  // ── Job details ─────────────────────────────────────────────
  @Column({ type: 'varchar', length: 200 })
  company_name: string;

  @Column({ type: 'varchar', length: 300 })
  job_position: string;

  @Column({ type: 'text', nullable: true })
  job_description: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  job_url: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  job_location: string;

  @Column({ type: 'enum', enum: EmploymentType, nullable: true })
  employment_type: EmploymentType;

  @Column({ type: 'enum', enum: WorkMode, nullable: true })
  work_mode: WorkMode;

  // ── Compensation (posted) ───────────────────────────────────
  // `transformer: decimalToNumberTransformer` is required: Postgres `numeric`
  // is returned by the driver as a string (precision-preserving), which makes
  // the TS `: number` annotation a lie at runtime. Without coercion on read,
  // a load → edit → save round-trip emits `"3000.00"` (string) back to the
  // create/update DTO, where `@IsNumber()` rejects it.
  @Column({
    name: 'salary_min',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalToNumberTransformer,
  })
  salary_min: number;

  @Column({
    name: 'salary_max',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalToNumberTransformer,
  })
  salary_max: number;

  @Column({ type: 'varchar', length: 3, nullable: true })
  salary_currency: string;

  @Column({ type: 'enum', enum: PayPeriod, nullable: true })
  pay_period: PayPeriod;

  @Column({ type: 'boolean', nullable: true })
  salary_negotiable: boolean;

  // ── Pipeline state ──────────────────────────────────────────
  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.APPLIED,
  })
  status: ApplicationStatus;

  @Column({ type: 'enum', enum: ApplicationSource })
  application_source: ApplicationSource;

  @Column({ type: 'enum', enum: JobBoardSource, nullable: true })
  job_board_source: JobBoardSource;

  @Column({ type: 'enum', enum: AppliedVia, nullable: true })
  applied_via: AppliedVia;

  @Column({ type: 'enum', enum: ApplicationPriority, nullable: true })
  priority: ApplicationPriority;

  @Column({ type: 'text', array: true, nullable: true })
  tags: string[];

  @Column({ type: 'timestamp', nullable: true })
  application_deadline: Date;

  @Column({ type: 'timestamp', nullable: true })
  applied_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  decision_deadline: Date;

  @Column({ type: 'varchar', length: 500, nullable: true })
  next_action: string;

  // ── ATS & resume data ────────────────────────────────────────
  @Column({ type: 'float', nullable: true })
  ats_score: number;

  @Column({ type: 'jsonb', nullable: true })
  ats_analysis: any;

  @Column({ type: 'varchar', nullable: true })
  ats_match_history_id: string;

  @Column({ type: 'uuid', nullable: true })
  resume_generation_id: string;

  @Column({ type: 'text', nullable: true })
  resume_content: string;

  // ── Contacts ─────────────────────────────────────────────────
  @Column({ type: 'varchar', length: 200, nullable: true })
  recruiter_name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  recruiter_email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  recruiter_phone: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  hiring_manager_name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  hiring_manager_email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  contact_phone: string;

  @Column({ type: 'jsonb', nullable: true })
  contacts: IJobApplicationContact[];

  // ── Notes & narrative ────────────────────────────────────────
  @Column({ type: 'text', nullable: true })
  cover_letter: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  // ── Interview & follow-up ────────────────────────────────────
  @Column({ type: 'timestamp', nullable: true })
  interview_scheduled_at: Date;

  @Column({ type: 'text', nullable: true })
  interview_notes: string;

  @Column({ type: 'timestamp', nullable: true })
  follow_up_date: Date;

  // ── Rejection ────────────────────────────────────────────────
  @Column({ type: 'enum', enum: RejectionStage, nullable: true })
  rejection_stage: RejectionStage;

  @Column({ type: 'text', nullable: true })
  rejection_reason: string;

  @Column({ type: 'boolean', nullable: true })
  rejection_feedback_received: boolean;

  // ── Offer ────────────────────────────────────────────────────
  @Column({ type: 'jsonb', nullable: true })
  compensation_offer: IJobApplicationCompensationOffer;

  // ── Attachments / status timeline / metadata ─────────────────
  @Column({ type: 'jsonb', nullable: true })
  attachments: IJobApplicationAttachment[];

  @Column({ type: 'jsonb', nullable: true })
  status_history: IJobApplicationStatusHistoryEntry[];

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    skills_matched?: string[];
    skills_missing?: string[];
    application_method?: string;
    referral_source?: string;
    response_time?: number;
    interview_rounds?: number;
    [key: string]: any;
  };

  // ── System ───────────────────────────────────────────────────
  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // ── Relations ────────────────────────────────────────────────
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
