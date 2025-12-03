import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ResumeGeneration } from './resume-generations.entity';
import { Resume } from './resume.entity';
import { UserSubscription } from './user-subscription.entity';

export enum UserPlan {
  FREEMIUM = 'freemium',
  PREMIUM = 'premium',
}

export enum UserType {
  GUEST = 'guest',
  REGISTERED = 'registered',
}

export enum RegistrationType {
  GENERAL = 'general',
  GOOGLE = 'google',
}

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  full_name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({
    type: 'enum',
    enum: UserPlan,
    default: UserPlan.FREEMIUM,
  })
  plan: UserPlan;

  @Column({
    type: 'enum',
    enum: UserType,
    default: UserType.REGISTERED,
  })
  user_type: UserType;

  @Column({
    type: 'enum',
    enum: RegistrationType,
    default: RegistrationType.GENERAL,
  })
  registration_type: RegistrationType;

  @Column({ type: 'jsonb', nullable: true })
  oauth_provider_data: Record<string, any>;

  @Column({ nullable: true })
  guest_id: string; // For tracking guest users

  @Column({ nullable: true })
  ip_address: string; // For rate limiting

  @Column({ nullable: true })
  user_agent: string; // For additional tracking

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => ResumeGeneration, (resume) => resume.user)
  resumes: ResumeGeneration[];

  @OneToMany(() => Resume, (resume) => resume.user, { cascade: true })
  uploadedResumes: Resume[];

  @OneToMany(() => UserSubscription, (subscription) => subscription.user)
  subscriptions: UserSubscription[];
}
