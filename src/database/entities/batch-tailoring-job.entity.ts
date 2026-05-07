import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { BatchTailoringRun } from './batch-tailoring-run.entity';
import { ResumeGeneration } from './resume-generations.entity';

export type BatchJobState =
  | 'queued'
  | 'analyzing'
  | 'optimizing'
  | 'finalizing'
  | 'completed'
  | 'failed';

@Entity({ name: 'batch_tailoring_jobs' })
@Index(['batch_id', 'job_index'])
@Unique('uq_batch_job_index', ['batch_id', 'job_index'])
export class BatchTailoringJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  batch_id: string;

  @ManyToOne(() => BatchTailoringRun, (b) => b.jobs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'batch_id' })
  batch: BatchTailoringRun;

  @Column({ type: 'int' })
  job_index: number;

  @Column({ type: 'varchar', length: 255 })
  job_position: string;

  @Column({ type: 'varchar', length: 255 })
  company_name: string;

  @Column({ type: 'text' })
  job_description: string;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  state: BatchJobState;

  @Column({ type: 'uuid', nullable: true })
  resume_generation_id: string | null;

  @ManyToOne(() => ResumeGeneration, { nullable: true })
  @JoinColumn({ name: 'resume_generation_id' })
  resume_generation: ResumeGeneration | null;

  @Column({ type: 'text', nullable: true })
  error_message: string | null;

  @Column({ type: 'timestamp', nullable: true })
  started_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  completed_at: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;
}
