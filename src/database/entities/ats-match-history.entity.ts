import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity({ name: 'ats_match_histories' })
export class AtsMatchHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  user_id: string; // Registered user

  @Column({ nullable: true })
  guest_id: string; // Guest user/session

  @Column('text')
  resume_content: string;

  @Column('text')
  job_description: string;

  @Column({ nullable: true })
  company_name: string;

  @Column('float')
  ats_score: number;

  @Column('jsonb', { nullable: true })
  analysis: any; // Store breakdown, recommendations, etc.

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
