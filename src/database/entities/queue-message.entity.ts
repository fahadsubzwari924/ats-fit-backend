import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type QueueMessageStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'retrying';

export type QueueMessagePriority = 'low' | 'normal' | 'high' | 'critical';

/**
 * Universal queue message tracking entity
 * Provides comprehensive auditing, debugging, and monitoring capabilities
 * for all queue operations across the system
 */
@Entity('queue_messages')
@Index(['queueName', 'status'])
@Index(['jobType', 'status'])
@Index(['userId', 'status'])
@Index(['entityName', 'entityId'])
@Index(['correlationId'])
@Index(['status', 'queuedAt'])
@Index(['status', 'attempts', 'maxAttempts'])
export class QueueMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'queue_name', type: 'varchar', length: 100 })
  queueName: string;

  @Column({ name: 'job_type', type: 'varchar', length: 100 })
  jobType: string;

  @Column({ name: 'correlation_id', type: 'uuid', nullable: true })
  correlationId: string | null;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'entity_name', type: 'varchar', length: 100, nullable: true })
  entityName: string | null;

  @Column({ name: 'entity_id', type: 'varchar', length: 255, nullable: true })
  entityId: string | null;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, any>;

  @Column({ name: 'result', type: 'jsonb', nullable: true })
  result: Record<string, any> | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ['queued', 'processing', 'completed', 'failed', 'retrying'],
    default: 'queued',
  })
  status: QueueMessageStatus;

  @Column({
    name: 'priority',
    type: 'enum',
    enum: ['low', 'normal', 'high', 'critical'],
    default: 'normal',
  })
  priority: QueueMessagePriority;

  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 3 })
  maxAttempts: number;

  @Column({
    name: 'queued_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  queuedAt: Date;

  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'processing_duration_ms', type: 'integer', nullable: true })
  processingDurationMs: number | null;

  @Column({ name: 'error_details', type: 'text', nullable: true })
  errorDetails: string | null;

  @Column({ name: 'metadata', type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Helper methods for better usability
  get isCompleted(): boolean {
    return this.status === 'completed';
  }

  get isFailed(): boolean {
    return this.status === 'failed';
  }

  get canRetry(): boolean {
    return this.attempts < this.maxAttempts && this.status === 'failed';
  }

  get hasExceededMaxAttempts(): boolean {
    return this.attempts >= this.maxAttempts;
  }
}
