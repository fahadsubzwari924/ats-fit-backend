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
import { JobApplication } from './job-application.entity';
import { InterviewStage } from '../../modules/job-application/enums/interview-stage.enum';
import { InterviewFormat } from '../../modules/job-application/enums/interview-format.enum';
import { InterviewOutcome } from '../../modules/job-application/enums/interview-outcome.enum';

@Entity({ name: 'job_application_interviews' })
@Index(['job_application_id', 'scheduled_at'])
export class JobApplicationInterview {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  job_application_id: string;

  @Column({ type: 'enum', enum: InterviewStage })
  stage: InterviewStage;

  @Column({ type: 'enum', enum: InterviewFormat, nullable: true })
  format: InterviewFormat;

  @Column({
    type: 'enum',
    enum: InterviewOutcome,
    default: InterviewOutcome.PENDING,
  })
  outcome: InterviewOutcome;

  @Column({ type: 'timestamp', nullable: true })
  scheduled_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  completed_at: Date;

  @Column({ type: 'integer', nullable: true })
  duration_minutes: number;

  @Column({ type: 'varchar', length: 200, nullable: true })
  interviewer_name: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  interviewer_email: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  location_or_link: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => JobApplication, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'job_application_id' })
  job_application: JobApplication;
}
