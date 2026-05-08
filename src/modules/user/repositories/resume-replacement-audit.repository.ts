import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResumeReplacementAudit } from '../../../database/entities/resume-replacement-audit.entity';
import { ResumeReplacementKind } from '../../../shared/enums/resume-replacement.enum';

export interface RecordAttemptInput {
  userId: string;
  kind: ResumeReplacementKind;
  succeeded: boolean;
  archivedExtractId?: string | null;
  newExtractId?: string | null;
  failureCode?: string | null;
  idempotencyKey?: string | null;
}

@Injectable()
export class ResumeReplacementAuditRepository {
  constructor(
    @InjectRepository(ResumeReplacementAudit)
    private readonly repo: Repository<ResumeReplacementAudit>,
  ) {}

  async recordAttempt(
    input: RecordAttemptInput,
  ): Promise<ResumeReplacementAudit> {
    const row = this.repo.create({
      userId: input.userId,
      kind: input.kind,
      succeeded: input.succeeded,
      archivedExtractId: input.archivedExtractId ?? null,
      newExtractId: input.newExtractId ?? null,
      failureCode: input.failureCode ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    });
    return this.repo.save(row);
  }

  async findRecentByIdempotencyKey(
    userId: string,
    idempotencyKey: string,
    withinSeconds: number,
  ): Promise<ResumeReplacementAudit | null> {
    const cutoff = new Date(Date.now() - withinSeconds * 1000);
    return this.repo
      .createQueryBuilder('a')
      .where('a.userId = :userId', { userId })
      .andWhere('a.idempotencyKey = :key', { key: idempotencyKey })
      .andWhere('a.attemptedAt >= :cutoff', { cutoff })
      .orderBy('a.attemptedAt', 'DESC')
      .getOne();
  }

  async countSucceededReplacementsInWindow(
    userId: string,
    windowStart: Date,
  ): Promise<number> {
    return this.repo
      .createQueryBuilder('a')
      .where('a.userId = :userId', { userId })
      .andWhere('a.kind = :kind', { kind: ResumeReplacementKind.REPLACEMENT })
      .andWhere('a.succeeded = true')
      .andWhere('a.attemptedAt >= :windowStart', { windowStart })
      .getCount();
  }
}
