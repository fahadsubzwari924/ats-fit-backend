import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResumeTemplateService } from './resume-templates.service';
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
  ) {}

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
      throw new Error(`Resume content extraction failed: ${errorMessage}`);
    }
  }
}
