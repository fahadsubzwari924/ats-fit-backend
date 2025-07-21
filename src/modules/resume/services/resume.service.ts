import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResumeTemplateService } from './resume-templates.service';
import { AIService } from './ai.service';
import * as pdf from 'pdf-parse';
import { BadRequestException } from '../../../shared/exceptions/custom-http-exceptions';
import { GeneratePdfService } from './generate-pdf.service';
import { AnalysisResultSchema } from '../schemas/resume-tailored-content.schema';
import { AnalysisResult } from '../interfaces/resume-extracted-keywords.interface';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { Resume } from '../../../database/entities/resume.entity';
import { User } from '../../../database/entities/user.entity';
import { S3Service } from '../../../shared/modules/external/services/s3.service';
import { MimeTypes } from '../../../shared/constants/mime-types.enum';

@Injectable()
export class ResumeService {
  private readonly logger = new Logger(ResumeService.name);
  private readonly SUPPORTED_MIME_TYPES = ['application/pdf'];
  private templateCache = new Map<string, any>();

  constructor(
    private templateService: ResumeTemplateService,
    private aiService: AIService,
    private generatePdfService: GeneratePdfService,
    private configService: ConfigService,

    @InjectRepository(ResumeGeneration)
    private readonly resumeGenerationRepository: Repository<ResumeGeneration>,

    @InjectRepository(Resume)
    private readonly resumeRepository: Repository<Resume>,

    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    private readonly s3Service: S3Service,
  ) {}

  async generateTailoredResume(
    jobDescription: string,
    companyName: string,
    resumeFile: Express.Multer.File,
    templateId: string,
  ) {
    this.validateFile(resumeFile);

    // Parallel execution of independent operations
    const templateStart = Date.now();
    const [template, resumeText] = await Promise.all([
      this.getTemplateWithCache(templateId),
      this.extractTextFromResume(resumeFile),
    ]);
    this.logger.log(
      `Template and text extraction: ${Date.now() - templateStart}ms`,
    );

    // Analyze resume and job description with AI
    const aiStart = Date.now();
    const analysisResult = await this.aiService.analyzeResumeAndJobDescription(
      resumeText,
      jobDescription,
      companyName,
    );
    this.logger.log(`AI analysis: ${Date.now() - aiStart}ms`);

    // Validate and ensure correct structure
    const validatedResult = AnalysisResultSchema.parse(
      analysisResult,
    ) as AnalysisResult;

    // Apply the template with the analyzed data
    const templateApplyStart = Date.now();
    if (typeof template === 'string') {
      throw new BadRequestException(
        'Template is not of the expected type',
        ERROR_CODES.INVALID_TEMPLATE_TYPE,
      );
    }
    const tailoredResume = await this.templateService.applyTemplate(
      template,
      validatedResult,
    );
    this.logger.log(
      `Template application: ${Date.now() - templateApplyStart}ms`,
    );

    // For API response
    return {
      orignalResumeText: resumeText,
      tailoredResume,
      analysis: validatedResult,
    };
  }

  private async getTemplateWithCache(templateId: string) {
    // Get cache TTL from configuration
    const cacheTtl = this.configService.get<number>(
      'performance.resumeServiceCacheTtl',
      300000,
    );

    // Check cache first
    if (this.templateCache.has(templateId)) {
      return this.templateCache.get(templateId) as string; // Ensure the value has the correct type
    }

    // Fetch from service and cache
    const template = await this.templateService.getTemplateById(templateId);
    this.templateCache.set(templateId, template);

    // Clear cache after configured time to prevent memory leaks
    setTimeout(() => {
      this.templateCache.delete(templateId);
    }, cacheTtl);

    return template;
  }

  private async extractTextFromPdf(buffer: Buffer): Promise<string> {
    try {
      const data = await pdf(buffer);
      return data.text;
    } catch (error) {
      this.logger.error('PDF text extraction failed', error);
      throw new Error('Failed to parse PDF resume');
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

  private validateFile(file: Express.Multer.File) {
    if (!this.SUPPORTED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type: ${file.mimetype}. Supported types: ${this.SUPPORTED_MIME_TYPES.join(', ')}`,
      );
    }

    const maxFileSize = this.configService.get<number>(
      'performance.maxFileSize',
      5242880,
    );
    if (file.size > maxFileSize) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${maxFileSize / 1024 / 1024}MB`,
      );
    }
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
}
