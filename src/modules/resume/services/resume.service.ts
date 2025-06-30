// resume.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResumeTemplateService } from './resume-templates.service';
import { AIService } from './ai.service';
import * as pdf from 'pdf-parse';
import { BadRequestException } from '../../../shared/exceptions/custom-http-exceptions';
import { GeneratePdfService } from './generate-pdf.service';
import { Response } from 'express';
import { AnalysisResultSchema } from '../schemas/resume-tailored-content.schema';
import { AnalysisResult } from '../interfaces/resume-extracted-keywords.interface';

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
  ) {}

  async generateTailoredResume(
    jobDescription: string,
    companyName: string,
    resumeFile: Express.Multer.File,
    templateId: string,
    res?: Response,
  ) {
    const startTime = Date.now();
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
    const validatedResult = AnalysisResultSchema.parse(analysisResult)  as AnalysisResult;

    // Apply the template with the analyzed data
    const templateApplyStart = Date.now();
    const tailoredResume = await this.templateService.applyTemplate(
      template,
      validatedResult,
    );
    this.logger.log(
      `Template application: ${Date.now() - templateApplyStart}ms`,
    );

    // Generate PDF from HTML
    const pdfStart = Date.now();
    const pdfBuffer =
      await this.generatePdfService.generatePdfFromHtml(tailoredResume);
    this.logger.log(`PDF generation: ${Date.now() - pdfStart}ms`);

    const totalTime = Date.now() - startTime;
    this.logger.log(`Total resume generation time: ${totalTime}ms`);

    // Return the generated PDF
    if (res) {
      // For direct download
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename=tailored-resume-${Date.now()}.pdf`,
        'Content-Length': pdfBuffer.length,
      });
      res.end(pdfBuffer);
      return;
    }

    // For API response
    return {
      pdfBuffer,
      analysis: validatedResult.metadata,
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
      return this.templateCache.get(templateId);
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

    throw new Error('Unsupported file type');
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
}
