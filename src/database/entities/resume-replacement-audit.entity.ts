import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ResumeReplacementKind } from '../../shared/enums/resume-replacement.enum';
import { User } from './user.entity';
import { ExtractedResumeContent } from './extracted-resume-content.entity';

@Entity('resume_replacement_audit')
@Index('idx_resume_replacement_audit_user_attempted', ['userId', 'attemptedAt'])
export class ResumeReplacementAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({
    type: 'enum',
    enum: ResumeReplacementKind,
    default: ResumeReplacementKind.REPLACEMENT,
  })
  kind!: ResumeReplacementKind;

  @CreateDateColumn({ name: 'attempted_at', type: 'timestamptz' })
  attemptedAt!: Date;

  @Column({ type: 'boolean' })
  succeeded!: boolean;

  @Column({ name: 'archived_extract_id', type: 'uuid', nullable: true })
  archivedExtractId!: string | null;

  @ManyToOne(() => ExtractedResumeContent, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'archived_extract_id' })
  archivedExtract!: ExtractedResumeContent | null;

  @Column({ name: 'new_extract_id', type: 'uuid', nullable: true })
  newExtractId!: string | null;

  @ManyToOne(() => ExtractedResumeContent, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'new_extract_id' })
  newExtract!: ExtractedResumeContent | null;

  @Column({ name: 'failure_code', type: 'text', nullable: true })
  failureCode!: string | null;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true })
  idempotencyKey!: string | null;
}
