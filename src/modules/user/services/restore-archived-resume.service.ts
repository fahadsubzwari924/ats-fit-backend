import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { ResumeReplacementAuditRepository } from '../repositories/resume-replacement-audit.repository';
import {
  ResumeReplacementErrorCode,
  ResumeReplacementKind,
} from '../../../shared/enums/resume-replacement.enum';
import { RESUME_REPLACEMENT } from '../../../shared/constants/resume-replacement.constants';

@Injectable()
export class RestoreArchivedResumeService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditRepo: ResumeReplacementAuditRepository,
  ) {}

  async execute(
    userId: string,
    archivedExtractId: string,
  ): Promise<{ restoredAt: Date }> {
    const target = await this.dataSource
      .getRepository(ExtractedResumeContent)
      .findOne({ where: { id: archivedExtractId, userId } });

    if (!target) {
      throw new NotFoundException({
        code: ResumeReplacementErrorCode.RESTORE_TARGET_NOT_FOUND,
        message: 'Archived resume not found.',
      });
    }

    if (target.isActive) {
      throw new ConflictException({
        code: ResumeReplacementErrorCode.RESTORE_TARGET_ALREADY_ACTIVE,
        message: 'That resume is already active.',
      });
    }

    const cutoff = new Date(
      Date.now() - RESUME_REPLACEMENT.RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    if (!target.archivedAt || target.archivedAt < cutoff) {
      throw new HttpException(
        {
          code: ResumeReplacementErrorCode.RESTORE_OUT_OF_WINDOW,
          message: `Restore window is ${RESUME_REPLACEMENT.RESTORE_WINDOW_DAYS} days.`,
        },
        HttpStatus.GONE,
      );
    }

    const restoredAt = new Date();

    await this.dataSource.transaction(async (em) => {
      await em.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);

      // Archive current active extract + resume
      await em.query(
        `UPDATE extracted_resume_contents SET is_active = false, archived_at = $1 WHERE user_id = $2 AND is_active = true`,
        [restoredAt, userId],
      );
      await em.query(
        `UPDATE user_resumes SET "isActive" = false, archived_at = $1 WHERE user_id = $2 AND "isActive" = true`,
        [restoredAt, userId],
      );

      // Restore target extract
      await em.query(
        `UPDATE extracted_resume_contents SET is_active = true, archived_at = NULL WHERE id = $1`,
        [archivedExtractId],
      );

      // Restore the most recently archived resume for this user as the paired record
      await em.query(
        `UPDATE user_resumes
         SET "isActive" = true, archived_at = NULL
         WHERE id = (
           SELECT id FROM user_resumes
           WHERE user_id = $1 AND "isActive" = false AND archived_at IS NOT NULL
           ORDER BY archived_at DESC LIMIT 1
         )`,
        [userId],
      );
    });

    await this.auditRepo.recordAttempt({
      userId,
      kind: ResumeReplacementKind.RESTORE,
      succeeded: true,
      newExtractId: archivedExtractId,
    });

    return { restoredAt };
  }
}
