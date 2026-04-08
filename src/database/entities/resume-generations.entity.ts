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

  @Column({ nullable: true })
  job_position: string;

  @Column('jsonb', { nullable: true })
  analysis: any;

  @Column({ nullable: true })
  keywords_added: number;

  @Column({ nullable: true })
  sections_optimized: number;

  @Column({ nullable: true })
  achievements_quantified: number;

  @Column('float', { nullable: true })
  optimization_confidence: number;

  @Column({ nullable: true })
  pdf_s3_key: string;

  @Column('jsonb', { nullable: true })
  job_analysis: any;

  @Column('jsonb', { nullable: true })
  candidate_content: any;

  @Column('jsonb', { nullable: true })
  changes_diff: any;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => User, { nullable: true })
  user: User;

  @ManyToOne(() => ResumeTemplate, { nullable: true })
  template: ResumeTemplate;
}
