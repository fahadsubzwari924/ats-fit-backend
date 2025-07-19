import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { ResumeTemplate } from './resume-templates.entity';

@Entity({ name: 'resume_generations' })
export class ResumeGeneration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  user_id: string;

  @Column({ nullable: true })
  guest_id: string;

  @Column()
  file_path: string;

  @Column('text')
  original_content: string;

  @Column('jsonb')
  tailored_content: any;

  @Column({ nullable: true })
  template_id: string;

  @Column({ nullable: true })
  job_description: string;

  @Column({ nullable: true })
  company_name: string;

  @Column('jsonb', { nullable: true })
  analysis: any;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => User, { nullable: true })
  user: User;

  @ManyToOne(() => ResumeTemplate, { nullable: true })
  template: ResumeTemplate;
}
