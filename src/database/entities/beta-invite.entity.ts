import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum BetaInviteStatus {
  PENDING = 'pending',
  REDEEMED = 'redeemed',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

@Entity({ name: 'beta_invites' })
export class BetaInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ unique: true, length: 16 })
  code: string;

  @Column({ type: 'timestamptz' })
  code_expires_at: Date;

  @Column({
    type: 'enum',
    enum: BetaInviteStatus,
    default: BetaInviteStatus.PENDING,
  })
  status: BetaInviteStatus;

  @Column({ default: 'wave-1', length: 50 })
  cohort: string;

  @Column({ type: 'smallint', default: 30 })
  access_days: number;

  @Column({ type: 'timestamptz', nullable: true })
  redeemed_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  redeemed_by_user_id: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  pro_access_until: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  @Column({ length: 200, nullable: true })
  revoked_reason: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
