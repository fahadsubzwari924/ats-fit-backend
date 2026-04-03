import { Process, Processor } from '@nestjs/bull';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { ExtractedResumeContent } from '../../../database/entities/extracted-resume-content.entity';
import { QueueMessage } from '../../../database/entities/queue-message.entity';
import { QueueMessageStatus } from '../../../shared/enums/queue-message.enum';
import { ResumeService } from '../services/resume.service';
import { ProfileQuestionGenerationService } from '../services/profile-question-generation.service';
import { ResumeExtractionJobData } from '../interfaces/resume-extraction.interface';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';

/**
 * Resume Extraction Processor
 *
 * Single responsibility: orchestrate the extract_resume_content job.
 * Delegates text extraction, structured extraction, and profile question
 * generation to dedicated services. Follows SRP and clean code.
 *
 * Domain: Resume Tailoring
 * Queue: resume_processing
 * Job Type: extract_resume_content
 */
@Processor('resume_processing')
export class ResumeExtractionProcessor implements OnModuleInit {
  private readonly logger = new Logger(ResumeExtractionProcessor.name);

  constructor(
    @InjectRepository(ExtractedResumeContent)
    private readonly extractedResumeRepository: Repository<ExtractedResumeContent>,
    @InjectRepository(QueueMessage)
    private readonly queueMessageRepository: Repository<QueueMessage>,
    private readonly resumeService: ResumeService,
    private readonly profileQuestionGenerationService: ProfileQuestionGenerationService,
  ) {
    this.logger.log('ResumeExtractionProcessor constructor called');
  }

  onModuleInit() {
    this.logger.log(
      'ResumeExtractionProcessor initialized and ready to process jobs',
    );
  }

  @Process('extract_resume_content')
  async handleResumeExtraction(
    job: Job<ResumeExtractionJobData>,
  ): Promise<void> {
    const { queueMessageId, userId, fileName, s3Url, resumeId } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `Starting resume extraction for user ${userId}, file: ${fileName}`,
      { queueMessageId, resumeId, jobId: job.id },
    );

    try {
      this.assertJobData(job.data);
      await this.updateQueueMessageStatus(
        queueMessageId,
        QueueMessageStatus.PROCESSING,
      );
      await job.progress(10);

      const fileBuffer = await this.resumeService.getResumeBufferFromS3(s3Url);
      const extractedText =
        await this.resumeService.extractTextFromResume({
          fieldname: 'resumeFile',
          originalname: fileName,
          encoding: '7bit',
          mimetype: 'application/pdf',
          buffer: fileBuffer,
          size: fileBuffer.length,
          stream: null,
          destination: '',
          filename: '',
          path: '',
        } as Express.Multer.File);
      await job.progress(50);

      const structuredContent =
        await this.resumeService.extractStructuredContentFromResume(
          extractedText,
        );
      await job.progress(80);

      const processingDuration = Date.now() - startTime;

      const [, questionsTotal] = await Promise.all([
        this.extractedResumeRepository.update(
          { id: resumeId },
          { extractedText, structuredContent },
        ),
        this.runProfileQuestionGeneration(userId, resumeId, structuredContent),
      ]);
      await job.progress(90);

      await this.updateQueueMessageStatus(
        queueMessageId,
        QueueMessageStatus.COMPLETED,
        {
          processingDurationMs: processingDuration,
          result: {
            success: true,
            resumeId,
            extractedContentSize: extractedText.length,
            hasStructuredContent: Object.keys(structuredContent).length > 0,
            questionsTotal,
          },
        },
      );
      await job.progress(100);

      this.logger.log(
        `Successfully processed resume ${fileName} for user ${userId} in ${processingDuration}ms`,
        { queueMessageId, resumeId, processingDurationMs: processingDuration },
      );
    } catch (error) {
      const processingDuration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      this.logger.error(
        `Failed to process resume ${fileName} for user ${userId}: ${errorMessage}`,
        {
          queueMessageId,
          resumeId,
          processingDurationMs: processingDuration,
          error: error instanceof Error ? error.stack : undefined,
        },
      );

      await this.updateQueueMessageStatus(
        queueMessageId,
        QueueMessageStatus.FAILED,
        {
          errorDetails: errorMessage,
          processingDurationMs: processingDuration,
        },
      );

      throw error;
    }
  }

  /**
   * Validates job data at the queue boundary. Throws if required fields are missing.
   * Ensures fail-fast before any async work; caught by handleResumeExtraction try/catch.
   *
   * Note: fileSize is intentionally excluded — it is stored as 0 on the record
   * because the actual file lives in S3. The real size is derived from the
   * downloaded buffer at processing time.
   */
  private assertJobData(data: ResumeExtractionJobData): void {
    const requiredStrings: (keyof ResumeExtractionJobData)[] = [
      'queueMessageId',
      'userId',
      'fileName',
      'resumeId',
      's3Url',
    ];
    for (const field of requiredStrings) {
      if (!data[field] || typeof data[field] !== 'string') {
        throw new Error(
          `Invalid job data: '${field}' is required and must be a non-empty string`,
        );
      }
    }
  }

  /**
   * Run Step 3 (profile question generation). Non-blocking: on failure
   * we log and return 0 so the user is not blocked.
   */
  private async runProfileQuestionGeneration(
    userId: string,
    extractedResumeContentId: string,
    structuredContent: TailoredContent,
  ): Promise<number> {
    try {
      return await this.profileQuestionGenerationService.generateAndSaveProfileQuestions(
        userId,
        extractedResumeContentId,
        structuredContent,
      );
    } catch (step3Error) {
      const errMsg =
        step3Error instanceof Error ? step3Error.message : String(step3Error);
      this.logger.error(
        `Step 3 profile question generation failed for user ${userId}, resume ${extractedResumeContentId}: ${errMsg}`,
        step3Error instanceof Error ? step3Error.stack : undefined,
      );
      return 0;
    }
  }

  private createTempFile(
    fileName: string,
    fileBuffer: Buffer,
    fileSize: number,
  ): Express.Multer.File {
    return {
      fieldname: 'resumeFile',
      originalname: fileName,
      encoding: '7bit',
      mimetype: 'application/pdf',
      buffer: fileBuffer,
      size: fileSize,
      stream: null,
      destination: '',
      filename: '',
      path: '',
    };
  }

  private async updateQueueMessageStatus(
    queueMessageId: string,
    status: QueueMessageStatus,
    additionalData?: {
      result?: Record<string, unknown>;
      errorDetails?: string;
      processingDurationMs?: number;
    },
  ): Promise<void> {
    const updateData: Partial<QueueMessage> = { status };

    if (status === QueueMessageStatus.PROCESSING) {
      updateData.startedAt = new Date();
    }

    if (
      status === QueueMessageStatus.COMPLETED ||
      status === QueueMessageStatus.FAILED
    ) {
      updateData.completedAt = new Date();
      if (additionalData?.processingDurationMs) {
        updateData.processingDurationMs = additionalData.processingDurationMs;
      }
    }

    if (additionalData?.result) {
      updateData.result = additionalData.result;
    }
    if (additionalData?.errorDetails) {
      updateData.errorDetails = additionalData.errorDetails;
    }

    await this.queueMessageRepository
      .createQueryBuilder()
      .update(QueueMessage)
      .set({
        ...updateData,
        attempts: () => 'attempts + 1',
      })
      .where('id = :id', { id: queueMessageId })
      .execute();

    this.logger.log(
      `Updated queue message ${queueMessageId} status to ${status}`,
    );
  }
}
