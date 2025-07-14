import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { UserPlan, UserType } from './user.entity';
import { FeatureType } from './usage-tracking.entity';

@Entity({ name: 'rate_limit_configs' })
@Index(['plan', 'user_type', 'feature_type'], { unique: true })
export class RateLimitConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: UserPlan,
  })
  plan: UserPlan;

  @Column({
    type: 'enum',
    enum: UserType,
  })
  user_type: UserType;

  @Column({
    type: 'enum',
    enum: FeatureType,
  })
  feature_type: FeatureType;

  @Column()
  monthly_limit: number;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
