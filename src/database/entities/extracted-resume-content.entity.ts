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
import { QueueMessage } from './queue-message.entity';
import { TailoredContent } from '../../modules/resume/interfaces/resume-extracted-keywords.interface';

/**
 * Business entity for successfully processed resume content
 * Contains only business-specific data, queue tracking is handled separately
 */
@Entity('extracted_resume_contents')
@Index(['userId'])
@Index(['fileHash'])
export class ExtractedResumeContent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'queue_message_id', type: 'uuid' })
  queueMessageId: string;

  @Column({ name: 'original_file_name', type: 'varchar', length: 255 })
  originalFileName: string;

  @Column({ name: 'file_size', type: 'integer' })
  fileSize: number;

  @Column({ name: 'file_hash', type: 'varchar', length: 64, unique: true })
  fileHash: string;

  @Column({ name: 'extracted_text', type: 'text' })
  extractedText: string;

  @Column({ name: 'structured_content', type: 'jsonb' })
  structuredContent: TailoredContent;

  @Column({ name: 'usage_count', type: 'integer', default: 0 })
  usageCount: number;

  @Column({ name: 'last_used_at', type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  @Column({ name: 'business_metadata', type: 'jsonb', default: {} })
  businessMetadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => User, (user) => user.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => QueueMessage, (queueMessage) => queueMessage.id, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'queue_message_id' })
  queueMessage: QueueMessage;

  // Helper methods for better usability
  get isRecentlyUsed(): boolean {
    if (!this.lastUsedAt) return false;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    return this.lastUsedAt > thirtyDaysAgo;
  }

  incrementUsageCount(): void {
    this.usageCount += 1;
    this.lastUsedAt = new Date();
  }
}
