import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { QueueMessage } from './queue-message.entity';
import { User } from './user.entity';

/**
 * Resume Generation Result Entity
 *
 * Stores the results of async resume generation jobs.
 * Separated from queue_messages to follow Single Responsibility Principle.
 *
 * This entity:
 * - Stores the generated PDF content (base64 or S3 URL)
 * - Tracks generation metadata and metrics
 * - Links to queue message for audit trail
 * - Auto-expires after 7 days to manage storage
 */
@Entity('resume_generation_results')
@Index(['userId'])
@Index(['guestId'])
@Index(['queueMessageId'])
@Index(['expiresAt'])
@Index(['userId', 'createdAt'])
export class ResumeGenerationResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Relationships
  @Column({ type: 'uuid', nullable: true, name: 'queue_message_id' })
  queueMessageId: string;

  @ManyToOne(() => QueueMessage, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'queue_message_id' })
  queueMessage: QueueMessage;

  @Column({ type: 'uuid', nullable: true, name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'guest_id' })
  guestId: string;

  // PDF Storage
  @Column({ type: 'text', nullable: true, name: 'pdf_content' })
  pdfContent: string; // base64 encoded PDF

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'pdf_url' })
  pdfUrl: string; // S3 URL if using cloud storage

  @Column({ type: 'varchar', length: 255, name: 'filename' })
  filename: string;

  @Column({ type: 'int', name: 'file_size_bytes' })
  fileSizeBytes: number;

  // Generation Details
  @Column({ type: 'uuid', name: 'resume_generation_id' })
  resumeGenerationId: string; // Reference to resume_generations table

  @Column({ type: 'int', name: 'ats_score' })
  atsScore: number;

  @Column({ type: 'int', name: 'ats_confidence', default: 0 })
  atsConfidence: number;

  @Column({ type: 'uuid', nullable: true, name: 'ats_match_history_id' })
  atsMatchHistoryId: string;

  // Request Metadata
  @Column({ type: 'varchar', length: 50, name: 'template_id' })
  templateId: string;

  @Column({ type: 'varchar', length: 255, name: 'company_name' })
  companyName: string;

  @Column({ type: 'varchar', length: 255, name: 'job_position' })
  jobPosition: string;

  // Optimization Metrics
  @Column({ type: 'int', name: 'keywords_added', default: 0 })
  keywordsAdded: number;

  @Column({ type: 'int', name: 'sections_optimized', default: 0 })
  sectionsOptimized: number;

  @Column({ type: 'int', name: 'optimization_confidence', default: 0 })
  optimizationConfidence: number;

  // Processing Metrics
  @Column({ type: 'jsonb', nullable: true, name: 'processing_metrics' })
  processingMetrics: {
    validationTimeMs: number;
    jobAnalysisTimeMs: number;
    resumeProcessingTimeMs: number;
    optimizationTimeMs: number;
    pdfGenerationTimeMs: number;
    atsEvaluationTimeMs: number;
    savingTimeMs: number;
    totalProcessingTimeMs: number;
  };

  // Additional Metadata
  @Column({ type: 'jsonb', nullable: true, name: 'metadata' })
  metadata: Record<string, any>;

  // Timestamps
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Auto-expire after 7 days
  @Column({
    type: 'timestamp',
    name: 'expires_at',
    default: () => "CURRENT_TIMESTAMP + INTERVAL '7 days'",
  })
  expiresAt: Date;
}
