import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { ExtractedResumeContent } from './extracted-resume-content.entity';

/**
 * Profile-level tailoring questions (source=profile).
 * Legacy per-job sessions were removed; questions are tied to user + extracted resume only.
 */
export type TailoringQuestionSource = 'profile';

@Entity({ name: 'tailoring_questions' })
export class TailoringQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'extracted_resume_content_id', type: 'uuid' })
  extractedResumeContentId: string;

  @Column({ name: 'source', type: 'varchar', length: 20, default: 'profile' })
  source: TailoringQuestionSource;

  @Column({ name: 'work_experience_index', type: 'int' })
  workExperienceIndex: number;

  @Column({ name: 'bullet_point_index', type: 'int' })
  bulletPointIndex: number;

  @Column({ name: 'original_bullet_point', type: 'text' })
  originalBulletPoint: string;

  @Column({ name: 'question_text', type: 'text' })
  questionText: string;

  @Column({ name: 'question_category', type: 'varchar', length: 50 })
  questionCategory: string;

  @Column({ name: 'user_response', type: 'text', nullable: true })
  userResponse: string;

  @Column({ name: 'is_answered', type: 'boolean', default: false })
  isAnswered: boolean;

  @Column({ name: 'order_index', type: 'int' })
  orderIndex: number;

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
