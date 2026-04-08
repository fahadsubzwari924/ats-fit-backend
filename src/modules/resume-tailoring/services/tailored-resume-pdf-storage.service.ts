import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { S3Service } from '../../../shared/modules/external/services/s3.service';

const MAX_UPLOAD_ATTEMPTS = 3;
const INITIAL_BACKOFF_MS = 300;

/**
 * Persists generated tailored resume PDFs to S3 for later download from history.
 * Single responsibility: bucket resolution, key layout, upload retries.
 */
@Injectable()
export class TailoredResumePdfStorageService {
  private readonly logger = new Logger(TailoredResumePdfStorageService.name);
  private hasLoggedCandidatesBucketFallback = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Bucket for tailored PDF objects (upload + download must use the same value).
   * Prefers AWS_S3_GENERATED_RESUMES_BUCKET; if unset/empty, uses AWS_S3_CANDIDATES_RESUMES_BUCKET
   * so dev setups that only configure the candidates bucket still persist pdf_s3_key.
   */
  getBucketForTailoredPdfs(): string | null {
    const dedicated = this.nonEmptyEnv('AWS_S3_GENERATED_RESUMES_BUCKET');
    if (dedicated) {
      return dedicated;
    }
    const fallback = this.nonEmptyEnv('AWS_S3_CANDIDATES_RESUMES_BUCKET');
    if (fallback) {
      if (!this.hasLoggedCandidatesBucketFallback) {
        this.hasLoggedCandidatesBucketFallback = true;
        this.logger.log(
          'AWS_S3_GENERATED_RESUMES_BUCKET not set; tailored PDFs use AWS_S3_CANDIDATES_RESUMES_BUCKET (object keys: tailored-resumes/...). Set AWS_S3_GENERATED_RESUMES_BUCKET for a dedicated bucket.',
        );
      }
      return fallback;
    }
    this.logger.warn(
      'Tailored PDF S3 persistence disabled: set AWS_S3_GENERATED_RESUMES_BUCKET or AWS_S3_CANDIDATES_RESUMES_BUCKET',
    );
    return null;
  }

  private nonEmptyEnv(key: string): string | undefined {
    const v = this.configService.get<string>(key);
    const t = typeof v === 'string' ? v.trim() : '';
    return t.length > 0 ? t : undefined;
  }

  /**
   * Uploads a generated PDF. Returns S3 object key on success, or null if the bucket
   * is not configured or upload ultimately fails.
   */
  async uploadGeneratedPdf(
    pdfBuffer: Buffer,
    ownerId: string,
  ): Promise<string | null> {
    const bucket = this.getBucketForTailoredPdfs();
    if (!bucket) {
      return null;
    }

    const safeOwner = this.sanitizeOwnerSegment(ownerId);
    const key = `tailored-resumes/${safeOwner}/${randomUUID()}.pdf`;

    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt++) {
      try {
        await this.s3Service.uploadFile({
          bucketName: bucket,
          key,
          file: pdfBuffer,
          contentType: 'application/pdf',
        });
        return key;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!this.isTransientUploadFailure(msg)) {
          this.logger.warn(
            `[Non-fatal] Tailored PDF S3 upload failed (non-retryable): ${msg}`,
          );
          return null;
        }
        if (attempt === MAX_UPLOAD_ATTEMPTS) {
          this.logger.warn(
            `[Non-fatal] Tailored PDF S3 upload failed after ${MAX_UPLOAD_ATTEMPTS} attempts: ${msg}`,
          );
          return null;
        }
        const delayMs = INITIAL_BACKOFF_MS * 2 ** (attempt - 1);
        this.logger.warn(
          `Tailored PDF S3 upload attempt ${attempt}/${MAX_UPLOAD_ATTEMPTS} failed (transient), retrying in ${delayMs}ms`,
        );
        await this.delay(delayMs);
      }
    }

    return null;
  }

  private sanitizeOwnerSegment(ownerId: string): string {
    const trimmed = (ownerId || 'unknown').trim() || 'unknown';
    return trimmed.replace(/[^a-zA-Z0-9_.\-:@]/g, '_').slice(0, 200);
  }

  /**
   * S3Service maps SDK errors to Error messages; avoid retrying obvious config/auth issues.
   */
  private isTransientUploadFailure(message: string): boolean {
    const m = message.toLowerCase();
    if (m.includes('access denied')) {
      return false;
    }
    if (m.includes('bucket not found')) {
      return false;
    }
    if (m.includes('nosuchbucket')) {
      return false;
    }
    return true;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
