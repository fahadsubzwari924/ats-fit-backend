import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum FeatureType {
  RESUME_GENERATION = 'resume_generation',
  ATS_SCORE = 'ats_score',
  ATS_SCORE_HISTORY = 'ats_score_history',
  JOB_APPLICATION_TRACKING = 'job_application_tracking',
}

@Entity({ name: 'usage_tracking' })
@Index(['user_id', 'feature_type', 'month', 'year'])
@Index(['guest_id', 'feature_type', 'month', 'year'])
@Index(['ip_address', 'feature_type', 'month', 'year'])
export class UsageTracking {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  user_id: string; // For registered users

  @Column({ nullable: true })
  guest_id: string; // For guest users

  @Column({ nullable: true })
  ip_address: string; // For additional tracking

  @Column({
    type: 'enum',
    enum: FeatureType,
  })
  feature_type: FeatureType;

  @Column()
  month: number; // 1-12

  @Column()
  year: number;

  @Column({ default: 1 })
  usage_count: number;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_used_at: Date;

  @ManyToOne(() => User, { nullable: true })
  user: User;
}
