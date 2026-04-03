import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResumeTemplateService } from './resume-templates.service';
import { TailoredResumePdfStorageService } from './tailored-resume-pdf-storage.service';
import { AIContentService } from '../../../shared/services/ai-content.service';
import * as pdf from 'pdf-parse';
import { BadRequestException } from '../../../shared/exceptions/custom-http-exceptions';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { Resume } from '../../../database/entities/resume.entity';
import { User } from '../../../database/entities/user.entity';
import { S3Service } from '../../../shared/modules/external/services/s3.service';
import { MimeTypes } from '../../../shared/constants/mime-types.enum';
import { AtsEvaluationService } from '../../../shared/services/ats-evaluation.service';
import { PromptService } from '../../../shared/services/prompt.service';

export interface ResumeHistoryItem {
  id: string;
  companyName: string;
  jobPosition: string;
  optimizationConfidence: number | null;
  keywordsAdded: number | null;
  sectionsOptimized: number | null;
  templateId: string | null;
  createdAt: Date;
  /** True when a PDF is stored in S3 and download-by-id will succeed */
  canDownload: boolean;
}

export interface ResumeHistoryDetail extends ResumeHistoryItem {
  achievementsQuantified: number | null;
  changesDiff: any;
}

export interface PaginatedResumeHistory {
  items: ResumeHistoryItem[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ResumeService {
  private readonly logger = new Logger(ResumeService.name);
  private templateCache = new Map<string, any>();

  constructor(
    private templateService: ResumeTemplateService,
    private aiContentService: AIContentService,
    private configService: ConfigService,
    private atsEvaluationService: AtsEvaluationService,
    private promptService: PromptService,

    @InjectRepository(ResumeGeneration)
    private readonly resumeGenerationRepository: Repository<ResumeGeneration>,

    @InjectRepository(Resume)
    private readonly resumeRepository: Repository<Resume>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly s3Service: S3Service,
    private readonly tailoredResumePdfStorageService: TailoredResumePdfStorageService,
  ) {}

  private async extractTextFromPdf(buffer: Buffer): Promise<string> {
    try {
      const data = await pdf(buffer);
      return data.text;
    } catch (error) {
      this.logger.error('PDF text extraction failed', error);
      throw new BadRequestException(
        'Failed to parse PDF resume',
        ERROR_CODES.PDF_PARSE_FAILED,
      );
    }
  }

  async extractTextFromResume(file: Express.Multer.File): Promise<string> {
    if (file.mimetype === 'application/pdf') {
      return await this.extractTextFromPdf(file.buffer);
    }

    throw new BadRequestException(
      'Unsupported file type',
      ERROR_CODES.UNSUPPORTED_FILE_TYPE,
    );
  }

  async getResumeBufferFromS3(s3Url: string): Promise<Buffer> {
    const bucketName = this.configService.get<string>(
      'AWS_S3_CANDIDATES_RESUMES_BUCKET',
    );
    const key = this.s3Service.extractS3KeyFromUrl(s3Url);

    return this.s3Service.getObject({
      bucketName,
      key,
    });
  }

  async saveResumeGeneration(
    resumeGenerationPayload: Partial<ResumeGeneration>,
  ): Promise<void> {
    const resumeGeneration = this.resumeGenerationRepository.create(
      resumeGenerationPayload,
    );
    await this.resumeGenerationRepository.save(resumeGeneration);
  }

  async uploadUserResume(
    userId: string,
    resumeFile: Express.Multer.File,
  ): Promise<Resume> {
    // Find the user
    const user = await this.userRepository.findOne({
      where: { id: userId, is_active: true },
    });

    if (!user) {
      throw new NotFoundException('User not found', ERROR_CODES.USER_NOT_FOUND);
    }

    // Generate unique file name to avoid conflicts
    const timestamp = Date.now();
    const uniqueFileName = `${userId}-${timestamp}-${resumeFile.originalname}`;

    // Upload file to S3
    const s3Url = await this.uploadToS3(resumeFile, uniqueFileName);

    // Save resume in the database
    const resume = this.resumeRepository.create({
      fileName: resumeFile.originalname,
      fileSize: resumeFile.size,
      mimeType: resumeFile.mimetype,
      s3Url,
      user,
    });

    return await this.resumeRepository.save(resume);
  }

  async getResumeById(resumeId: string): Promise<Resume | null> {
    if (!resumeId) {
      throw new BadRequestException(
        'Resume ID is required',
        ERROR_CODES.RESUME_ID_REQUIRED_VALIDATION_ERROR,
      );
    }

    return this.resumeRepository.findOne({
      where: { id: resumeId, isActive: true },
      relations: ['user'],
    });
  }

  async deleteResume(resumeId: string): Promise<void> {
    const resume = await this.getResumeById(resumeId);
    if (!resume) {
      throw new NotFoundException(
        'Resume not found',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    await this.resumeRepository.remove(resume);

    // Extract the key from the full S3 URL
    const s3Key = this.s3Service.extractS3KeyFromUrl(resume.s3Url);

    await this.s3Service.deleteObject({
      bucketName: this.configService.get<string>(
        'AWS_S3_CANDIDATES_RESUMES_BUCKET',
      ),
      key: s3Key,
    });
  }

  private async uploadToS3(
    file: Express.Multer.File,
    customFileName?: string,
  ): Promise<string> {
    const bucketName = this.configService.get<string>(
      'AWS_S3_CANDIDATES_RESUMES_BUCKET',
    );

    // Validate file type
    if (!Object.values(MimeTypes).map(String).includes(file.mimetype)) {
      throw new BadRequestException(
        'Only PDF files are allowed',
        ERROR_CODES.UNSUPPORTED_FILE_TYPE,
      );
    }

    try {
      const fileName = customFileName || file.originalname;
      const key = await this.s3Service.uploadFile({
        bucketName,
        key: fileName,
        file: file.buffer,
        contentType: file.mimetype,
      });

      this.logger.log(`File uploaded successfully to S3: ${key}`);
      return `https://${bucketName}.s3.${this.configService.get<string>('AWS_BUCKET_REGION')}.amazonaws.com/${key}`;
    } catch (error) {
      this.logger.error('Error uploading file to S3', error);
      throw new BadRequestException(
        'Failed to upload file to S3',
        ERROR_CODES.S3_UPLOAD_FAILED,
      );
    }
  }

  async getUserResumes(userId: string): Promise<Resume[]> {
    if (!userId) {
      throw new BadRequestException(
        'User ID is required',
        ERROR_CODES.AUTHENTICATION_REQUIRED,
      );
    }

    return this.resumeRepository.find({
      where: { user: { id: userId }, isActive: true },
    });
  }

  async getResumeGenerationHistory(
    userId: string,
    limit = 10,
  ): Promise<ResumeHistoryItem[]> {
    const records = await this.resumeGenerationRepository.find({
      where: { user_id: userId },
      order: { created_at: 'DESC' },
      take: limit,
      select: [
        'id',
        'company_name',
        'job_position',
        'optimization_confidence',
        'keywords_added',
        'sections_optimized',
        'template_id',
        'created_at',
        'pdf_s3_key',
      ],
    });

    return records.map((r) => ({
      id: r.id,
      companyName: r.company_name,
      jobPosition: r.job_position,
      optimizationConfidence: r.optimization_confidence,
      keywordsAdded: r.keywords_added,
      sectionsOptimized: r.sections_optimized,
      templateId: r.template_id,
      createdAt: r.created_at,
      canDownload: Boolean(r.pdf_s3_key),
    }));
  }

  async getResumeGenerationHistoryPaginated(
    userId: string,
    options: {
      page?: number;
      limit?: number;
      search?: string;
      sortOrder?: 'ASC' | 'DESC';
    } = {},
  ): Promise<PaginatedResumeHistory> {
    const { page = 1, limit = 10, search, sortOrder = 'DESC' } = options;
    const skip = (page - 1) * limit;

    const qb = this.resumeGenerationRepository
      .createQueryBuilder('rg')
      .where('rg.user_id = :userId', { userId });

    if (search) {
      qb.andWhere(
        '(LOWER(rg.company_name) LIKE :search OR LOWER(rg.job_position) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    qb.select([
      'rg.id',
      'rg.company_name',
      'rg.job_position',
      'rg.optimization_confidence',
      'rg.keywords_added',
      'rg.sections_optimized',
      'rg.template_id',
      'rg.created_at',
      'rg.pdf_s3_key',
    ])
      .orderBy('rg.created_at', sortOrder)
      .skip(skip)
      .take(limit);

    const [records, total] = await qb.getManyAndCount();

    return {
      items: records.map((r) => ({
        id: r.id,
        companyName: r.company_name,
        jobPosition: r.job_position,
        optimizationConfidence: r.optimization_confidence,
        keywordsAdded: r.keywords_added,
        sectionsOptimized: r.sections_optimized,
        templateId: r.template_id,
        createdAt: r.created_at,
        canDownload: Boolean(r.pdf_s3_key),
      })),
      total,
      page,
      limit,
    };
  }

  async getResumeGenerationDetail(
    generationId: string,
    userId: string,
  ): Promise<ResumeHistoryDetail> {
    const record = await this.resumeGenerationRepository.findOne({
      where: { id: generationId, user_id: userId },
      select: [
        'id',
        'company_name',
        'job_position',
        'optimization_confidence',
        'keywords_added',
        'sections_optimized',
        'achievements_quantified',
        'changes_diff',
        'template_id',
        'created_at',
        'pdf_s3_key',
      ],
    });

    if (!record) {
      throw new NotFoundException(
        'Resume generation not found',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    return {
      id: record.id,
      companyName: record.company_name,
      jobPosition: record.job_position,
      optimizationConfidence: record.optimization_confidence,
      keywordsAdded: record.keywords_added,
      sectionsOptimized: record.sections_optimized,
      achievementsQuantified: record.achievements_quantified,
      changesDiff: record.changes_diff ?? null,
      canDownload: Boolean(record.pdf_s3_key),
      templateId: record.template_id,
      createdAt: record.created_at,
    };
  }

  async getChangesDiff(generationId: string, userId: string): Promise<any> {
    const record = await this.resumeGenerationRepository.findOne({
      where: { id: generationId, user_id: userId },
      select: ['id', 'changes_diff'],
    });

    if (!record) {
      throw new NotFoundException(
        'Resume generation not found',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return record.changes_diff ?? null;
  }

  async downloadResumeGeneration(
    generationId: string,
    userId: string,
  ): Promise<Buffer> {
    const record = await this.resumeGenerationRepository.findOne({
      where: { id: generationId, user_id: userId },
      select: ['id', 'pdf_s3_key', 'company_name', 'job_position'],
    });

    if (!record) {
      throw new NotFoundException(
        'Resume generation not found',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    if (!record.pdf_s3_key) {
      throw new NotFoundException(
        'PDF is no longer available for download',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    const bucket =
      this.tailoredResumePdfStorageService.getBucketForTailoredPdfs();
    if (!bucket) {
      throw new NotFoundException(
        'PDF is no longer available for download',
        ERROR_CODES.RESUME_NOT_FOUND,
      );
    }

    return this.s3Service.getObject({
      bucketName: bucket,
      key: record.pdf_s3_key,
    });
  }

  /**
   * Extract structured content from resume text without job-specific analysis
   * This method focuses solely on parsing and structuring resume content
   * Following Single Responsibility Principle - only handles content extraction
   *
   * @param resumeText - Raw text extracted from resume
   * @returns Promise<TailoredContent> - Structured resume content
   */
  async extractStructuredContentFromResume(
    resumeText: string,
  ): Promise<TailoredContent> {
    this.logger.log('Extracting structured content from resume text');

    try {
      // Use AI service to parse and structure the resume content
      // This focuses on content extraction, not job matching
      const structuredContent =
        await this.aiContentService.extractResumeContent(resumeText);

      this.logger.log('Successfully extracted structured content from resume');
      return structuredContent;
    } catch (error) {
      this.logger.error(
        'Failed to extract structured content from resume',
        error,
      );
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      throw new BadRequestException(
        `Resume content extraction failed: ${errorMessage}`,
        ERROR_CODES.RESUME_TEXT_EXTRACTION_FAILED,
      );
    }
  }
}
