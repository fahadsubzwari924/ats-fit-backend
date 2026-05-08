import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Resume } from '../../../database/entities/resume.entity';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { S3Service } from '../../../shared/modules/external/services/s3.service';
import { ResumeQueueService } from '../../resume-tailoring/services/resume-queue.service';
import { ReplacementQuotaService } from './replacement-quota.service';
import { ResumeReplacementAuditRepository } from '../repositories/resume-replacement-audit.repository';
import {
  ResumeReplacementErrorCode,
  ResumeReplacementKind,
} from '../../../shared/enums/resume-replacement.enum';
import { RESUME_REPLACEMENT } from '../../../shared/constants/resume-replacement.constants';
import { FileUtil } from '../../../shared/utils/file.util';
import {
  IReplaceResumeContext,
  IReplaceResumeResult,
} from '../interfaces/replace-resume.interface';
import { ReplaceResumeResponseDto } from '../dtos/replace-resume-response.dto';

@Injectable()
export class ReplaceResumeService {
  private readonly logger = new Logger(ReplaceResumeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly quota: ReplacementQuotaService,
    private readonly auditRepo: ResumeReplacementAuditRepository,
    private readonly s3Service: S3Service,
    private readonly configService: ConfigService,
    private readonly queueService: ResumeQueueService,
  ) {}

  async execute(ctx: IReplaceResumeContext): Promise<ReplaceResumeResponseDto> {
    try {
      await this.quota.assertCanReplace(ctx.userId);
    } catch (err) {
      await this.recordPreFailure(ctx, err);
      throw err;
    }

    if (ctx.idempotencyKey) {
      const existing = await this.auditRepo.findRecentByIdempotencyKey(
        ctx.userId,
        ctx.idempotencyKey,
        RESUME_REPLACEMENT.IDEMPOTENCY_REPLAY_WINDOW_SECONDS,
      );
      if (existing?.succeeded && existing.newExtractId) {
        const quota = await this.quota.getCurrentQuota(ctx.userId);
        return this.buildReplayResponse(existing, quota, ctx.userId);
      }
    }

    this.validateFile(ctx.file);

    const activeExtract = await this.dataSource
      .getRepository(ExtractedResumeContent)
      .findOne({ where: { userId: ctx.userId, isActive: true } });
    if (!activeExtract) {
      const err = new ConflictException({
        code: ResumeReplacementErrorCode.NO_ACTIVE_RESUME,
        message:
          'No active resume found. Use upload-resume for first-time setup.',
      });
      await this.recordPreFailure(ctx, err);
      throw err;
    }

    let s3Url: string;
    try {
      s3Url = await this.uploadResumeToS3(ctx.userId, ctx.file);
    } catch {
      const err = new HttpException(
        {
          code: ResumeReplacementErrorCode.STORAGE_UPLOAD_FAILED,
          message: 'Could not upload file. Try again.',
        },
        HttpStatus.BAD_GATEWAY,
      );
      await this.recordPreFailure(ctx, err);
      throw err;
    }

    // B6: Reject if the uploaded file is identical to the current active resume
    const incomingHash = FileUtil.generateFileHash(ctx.file.buffer);
    if (activeExtract.fileHash && activeExtract.fileHash === incomingHash) {
      const bucketName = this.configService.get<string>(
        'AWS_S3_CANDIDATES_RESUMES_BUCKET',
      );
      const s3Key = this.s3Service.extractS3KeyFromUrl(s3Url);
      await this.s3Service
        .deleteObject({ bucketName, key: s3Key })
        .catch((e) =>
          this.logger.warn('Failed to delete duplicate-upload S3 object', e),
        );
      throw new BadRequestException({
        code: ResumeReplacementErrorCode.SAME_FILE_AS_ACTIVE,
        message:
          'The uploaded file is identical to your current active resume.',
      });
    }

    let txResult: IReplaceResumeResult;
    try {
      txResult = await this.runReplacementTransaction(
        ctx,
        activeExtract,
        s3Url,
      );
    } catch (e) {
      this.logger.error('Replacement TX failed', e);
      await this.auditRepo.recordAttempt({
        userId: ctx.userId,
        kind: ResumeReplacementKind.REPLACEMENT,
        succeeded: false,
        failureCode:
          ResumeReplacementErrorCode[
            ResumeReplacementErrorCode.REPLACEMENT_TX_FAILED
          ],
        idempotencyKey: ctx.idempotencyKey ?? null,
      });
      throw new HttpException(
        {
          code: ResumeReplacementErrorCode.REPLACEMENT_TX_FAILED,
          message: 'Could not save replacement. Try again.',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    let newExtract: ExtractedResumeContent;
    try {
      newExtract = await this.queueService.addResumeProcessingJob(
        ctx.userId,
        ctx.file.originalname,
        s3Url,
      );
    } catch (qErr) {
      this.logger.error(
        'Queue enqueue failed after TX commit; sweeper will recover',
        qErr,
      );
      newExtract = { id: '' } as ExtractedResumeContent;
    }

    try {
      await this.auditRepo.recordAttempt({
        userId: ctx.userId,
        kind: ResumeReplacementKind.REPLACEMENT,
        succeeded: true,
        archivedExtractId: txResult.archivedExtractId,
        newExtractId: newExtract.id || null,
        idempotencyKey: ctx.idempotencyKey ?? null,
      });
    } catch (auditErr) {
      this.logger.warn('Audit insert failed post-commit', auditErr);
    }

    return {
      status: 'queued',
      newResumeId: txResult.newResumeId,
      newProcessingId: newExtract.id,
      archivedExtractId: txResult.archivedExtractId,
      archivedAt: txResult.archivedAt,
      quota: await this.quota.getCurrentQuota(ctx.userId),
    };
  }

  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new HttpException(
        {
          code: ResumeReplacementErrorCode.INVALID_FILE,
          message: 'Missing file.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (file.size > RESUME_REPLACEMENT.MAX_FILE_SIZE_BYTES) {
      throw new HttpException(
        {
          code: ResumeReplacementErrorCode.INVALID_FILE,
          message: 'File too large.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const allowed: readonly string[] = RESUME_REPLACEMENT.ALLOWED_MIME_TYPES;
    if (!allowed.includes(file.mimetype)) {
      throw new HttpException(
        {
          code: ResumeReplacementErrorCode.INVALID_FILE,
          message: 'Unsupported file type.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async uploadResumeToS3(
    userId: string,
    file: Express.Multer.File,
  ): Promise<string> {
    const bucketName = this.configService.get<string>(
      'AWS_S3_CANDIDATES_RESUMES_BUCKET',
    );
    const region = this.configService.get<string>('AWS_BUCKET_REGION');
    const uniqueFileName = `${userId}-${Date.now()}-${file.originalname}`;
    const key = await this.s3Service.uploadFile({
      bucketName,
      key: uniqueFileName,
      file: file.buffer,
      contentType: file.mimetype,
    });
    return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  }

  private async runReplacementTransaction(
    ctx: IReplaceResumeContext,
    activeExtract: ExtractedResumeContent,
    s3Url: string,
  ): Promise<IReplaceResumeResult> {
    return this.dataSource.transaction(async (em) => {
      await em.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [
        ctx.userId,
      ]);

      const now = new Date();

      await em.query(
        `UPDATE user_resumes SET "isActive" = false, archived_at = $1 WHERE user_id = $2 AND "isActive" = true`,
        [now, ctx.userId],
      );

      const newResume = em.create(Resume, {
        fileName: ctx.file.originalname,
        fileSize: ctx.file.size,
        mimeType: ctx.file.mimetype,
        s3Url,
        isActive: true,
        user: { id: ctx.userId } as Resume['user'],
      });
      const savedResume = await em.save(newResume);

      await em.query(
        `UPDATE extracted_resume_contents SET is_active = false, archived_at = $1 WHERE id = $2`,
        [now, activeExtract.id],
      );

      return {
        newResumeId: savedResume.id,
        newProcessingId: '',
        archivedExtractId: activeExtract.id,
        archivedAt: now,
      };
    });
  }

  private async recordPreFailure(
    ctx: IReplaceResumeContext,
    err: unknown,
  ): Promise<void> {
    try {
      const nestResponse = (err as { response?: { code?: string } }).response;
      const code: string = nestResponse?.code ?? 'UNKNOWN';
      await this.auditRepo.recordAttempt({
        userId: ctx.userId,
        kind: ResumeReplacementKind.REPLACEMENT,
        succeeded: false,
        failureCode: String(code),
        idempotencyKey: ctx.idempotencyKey ?? null,
      });
    } catch {
      /* non-fatal */
    }
  }

  private async buildReplayResponse(
    existing: {
      archivedExtractId: string | null;
      newExtractId: string | null;
      attemptedAt: Date;
    },
    quota: import('../interfaces/replacement-quota.interface').IReplacementQuota,
    userId: string,
  ): Promise<ReplaceResumeResponseDto> {
    const activeResume = await this.dataSource
      .getRepository(Resume)
      .findOne({ where: { user: { id: userId }, isActive: true } });

    const dto = new ReplaceResumeResponseDto();
    dto.status = 'queued';
    dto.newResumeId = activeResume?.id ?? '';
    dto.newProcessingId = existing.newExtractId ?? '';
    dto.archivedExtractId = existing.archivedExtractId ?? '';
    dto.archivedAt = existing.attemptedAt;
    dto.quota = quota;
    return dto;
  }
}
