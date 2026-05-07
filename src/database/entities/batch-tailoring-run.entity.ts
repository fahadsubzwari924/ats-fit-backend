import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BatchTailoringJob } from './batch-tailoring-job.entity';

export type BatchRunStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'partial'
  | 'failed';

@Entity({ name: 'batch_tailoring_runs' })
@Index(['user_id', 'created_at'])
export class BatchTailoringRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  template_id: string | null;

  @Column({ type: 'uuid', nullable: true })
  resume_id: string | null;

  @Column({ type: 'int' })
  total_jobs: number;

  @Column({ type: 'int', default: 0 })
  completed_jobs: number;

  @Column({ type: 'int', default: 0 })
  failed_jobs: number;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: BatchRunStatus;

  @Column({ type: 'int', default: 0 })
  last_event_id: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  completed_at: Date | null;

  @OneToMany(() => BatchTailoringJob, (j) => j.batch, { cascade: true })
  jobs: BatchTailoringJob[];
}
