import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Resume } from './resume.entity';

export enum UserPlan {
  FREEMIUM = 'freemium',
  PREMIUM = 'premium',
}

export enum UserType {
  GUEST = 'guest',
  REGISTERED = 'registered',
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

  @OneToMany(() => Resume, (resume) => resume.user)
  resumes: Resume[];
}
