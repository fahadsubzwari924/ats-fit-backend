import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { ExtractedResumeContent } from './extracted-resume-content.entity';
import { TailoredContent } from '../../modules/resume-tailoring/interfaces/resume-extracted-keywords.interface';

/**
 * Enriched Resume Profile Entity
 *
 * Single source of truth for resume content after user completes (or partially completes)
 * profile Q&A. Created after merging answered TailoringQuestion responses with original
 * structuredContent via AI. Used as the base content for all future resume tailoring.
 */
@Entity('enriched_resume_profiles')
@Index(['userId'])
export class EnrichedResumeProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'extracted_resume_content_id', type: 'uuid' })
  extractedResumeContentId: string;

  @Column({ name: 'enriched_content', type: 'jsonb' })
  enrichedContent: TailoredContent;

  @Column({ name: 'original_content', type: 'jsonb' })
  originalContent: TailoredContent;

  @Column({ name: 'profile_completeness', type: 'float', default: 0 })
  profileCompleteness: number;

  @Column({ name: 'questions_total', type: 'int', default: 0 })
  questionsTotal: number;

  @Column({ name: 'questions_answered', type: 'int', default: 0 })
  questionsAnswered: number;

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({ name: 'last_enriched_at', type: 'timestamp', nullable: true })
  lastEnrichedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => ExtractedResumeContent, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'extracted_resume_content_id' })
  extractedResumeContent: ExtractedResumeContent;
}
