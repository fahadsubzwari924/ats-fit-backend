import { Injectable, Logger } from '@nestjs/common';
import { ResumeTemplateService } from './resume-templates.service';
import { PdfGenerationService } from './pdf-generation.service';
import {
  TailoredContent,
  AnalysisResult,
} from '../interfaces/resume-extracted-keywords.interface';
import { ResumeOptimizationResult } from '../interfaces/resume-optimization.interface';
import { PdfGenerationResult } from '../interfaces/pdf-generation.interface';
import {
  InternalServerErrorException,
  BadRequestException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

/**
 * PDF Generation Orchestrator Service V2
 *
 * This service orchestrates the conversion of optimized resume content
 * into professional PDF documents by integrating:
 * - Resume template application with Handlebars
 * - Optimized PDF generation with Puppeteer
 * - Performance monitoring and error handling
 * - Content validation and formatting
 *
 * Key responsibilities:
 * - Template selection and validation
 * - HTML generation from optimized content
 * - PDF generation with proper formatting
 * - Performance tracking and optimization
 * - File naming and metadata management
 *
 * Integration points:
 * - ResumeTemplateService: For HTML template generation
 * - PdfGenerationService: For PDF conversion with configurable optimization
 * - Existing template system: Reuses proven template logic
 */
@Injectable()
export class PdfGenerationOrchestratorService {
  private readonly logger = new Logger(PdfGenerationOrchestratorService.name);

  constructor(
    private readonly resumeTemplateService: ResumeTemplateService,
    private readonly pdfGenerationService: PdfGenerationService,
  ) {}

  /**
   * Generate PDF from optimized resume content
   *
   * @param optimizationResult - Complete optimization result with content and metadata
   * @param templateId - Resume template ID to use for formatting
   * @param companyName - Target company name for filename generation
   * @param jobPosition - Target job position for filename generation
   * @returns Promise<PdfGenerationResult> - Generated PDF with metadata
   */
  async generateOptimizedResumePdf(
    optimizationResult: ResumeOptimizationResult,
    templateId: string,
    companyName: string,
    jobPosition: string,
  ): Promise<PdfGenerationResult> {
    const startTime = Date.now();

    try {
      this.validateInputs(
        optimizationResult,
        templateId,
        companyName,
        jobPosition,
      );

      this.logger.log(
        `Starting PDF generation for ${jobPosition} at ${companyName} using template ${templateId}`,
      );

      // Step 1: Retrieve and validate template
      const template = await this.getValidatedTemplate(templateId);

      // Step 2: Generate HTML from optimized content
      const htmlGenerationStart = Date.now();
      const htmlContent = await this.generateHtmlFromOptimizedContent(
        optimizationResult.optimizedContent,
        template,
      );
      const htmlGenerationTime = Date.now() - htmlGenerationStart;

      this.logger.debug(`HTML generation completed in ${htmlGenerationTime}ms`);

      // Step 3: Convert HTML to PDF
      const pdfGenerationStart = Date.now();
      const pdfResult = await this.pdfGenerationService.generatePdfFromHtml(
        htmlContent,
        { optimizationMode: 'optimized' }, // Use optimized mode for better performance
      );
      const pdfBuffer = pdfResult.buffer;
      const pdfGenerationTime = Date.now() - pdfGenerationStart;

      this.logger.debug(`PDF generation completed in ${pdfGenerationTime}ms`);

      // Step 4: Prepare result with metadata
      const pdfContent = Buffer.from(pdfBuffer).toString('base64');
      const filename = this.generateOptimizedFilename(
        companyName,
        jobPosition,
        optimizationResult.optimizationMetrics.confidenceScore,
      );

      const totalProcessingTime = Date.now() - startTime;

      this.logger.log(
        `PDF generation orchestration completed in ${totalProcessingTime}ms ` +
          `(HTML: ${htmlGenerationTime}ms, PDF: ${pdfGenerationTime}ms, ` +
          `Size: ${pdfBuffer.length} bytes, Score: ${optimizationResult.optimizationMetrics.confidenceScore})`,
      );

      return {
        pdfContent,
        filename,
        generationMetadata: {
          templateUsed: templateId,
          pdfSizeBytes: pdfBuffer.length,
          pageCount: 1, // Default to 1 page, could be calculated if needed
          generationTimeMs: totalProcessingTime,
          fontEmbedded: true, // Assuming fonts are embedded by default
        },
        templateInfo: {
          templateId,
          templateName: template.name || 'Unknown',
          version: '1.0', // Default version
        },
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `PDF generation orchestration failed after ${processingTime}ms`,
        error,
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to generate PDF from optimized resume content',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Retrieve and validate template exists and is accessible
   */
  private async getValidatedTemplate(templateId: string) {
    try {
      const template =
        await this.resumeTemplateService.getTemplateById(templateId);

      if (!template) {
        throw new BadRequestException(
          `Template with ID ${templateId} not found`,
          ERROR_CODES.RESUME_TEMPLATE_NOT_FOUND,
        );
      }

      return template;
    } catch (error) {
      this.logger.error(`Failed to retrieve template ${templateId}`, error);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        'Failed to retrieve resume template',
        ERROR_CODES.RESUME_TEMPLATE_NOT_FOUND,
      );
    }
  }

  /**
   * Generate HTML content from optimized resume data using template
   */
  private async generateHtmlFromOptimizedContent(
    optimizedContent: TailoredContent,
    template: any,
  ): Promise<string> {
    try {
      // Convert TailoredContent to AnalysisResult format for template compatibility
      const templateData = this.convertToTemplateFormat(optimizedContent);

      // Apply template to generate HTML
      const htmlContent = await this.resumeTemplateService.applyTemplate(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        template,
        templateData,
      );

      if (!htmlContent || htmlContent.trim() === '') {
        throw new Error('Generated HTML content is empty');
      }

      return htmlContent;
    } catch (error) {
      this.logger.error(
        'Failed to generate HTML from optimized content',
        error,
      );

      if (error instanceof Error) {
        throw new InternalServerErrorException(
          `Template application failed: ${error.message}`,
          ERROR_CODES.INTERNAL_SERVER,
        );
      }

      throw new InternalServerErrorException(
        'Failed to apply resume template',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Convert TailoredContent to AnalysisResult format for template compatibility
   */
  private convertToTemplateFormat(content: TailoredContent): AnalysisResult {
    this.logger.debug('Converting optimized content to template format');

    return {
      title: content.title || '',
      contactInfo: {
        name: content.contactInfo?.name || '',
        email: content.contactInfo?.email || '',
        phone: content.contactInfo?.phone || '',
        location: content.contactInfo?.location || '',
        linkedin: content.contactInfo?.linkedin || '',
        portfolio: content.contactInfo?.portfolio || '',
        github: content.contactInfo?.github || '',
      },
      summary: content.summary || '',
      skills: content.skills || {
        languages: [],
        frameworks: [],
        tools: [],
        databases: [],
        concepts: [],
      },
      experience: content.experience || [],
      education: content.education || [],
      certifications: Array.isArray(content.certifications)
        ? content.certifications
        : [],
      additionalSections: Array.isArray(content.additionalSections)
        ? content.additionalSections
        : [],
      metadata: {
        skillMatchScore: 85, // Default score since we don't have this from optimization
        missingKeywords: [], // Empty since content is already optimized
      },
    };
  }

  /**
   * Generate optimized filename based on job and optimization metrics
   */
  private generateOptimizedFilename(
    companyName: string,
    jobPosition: string,
    confidenceScore: number,
  ): string {
    // Sanitize strings for filename safety
    const sanitizedCompany = this.sanitizeForFilename(companyName);
    const sanitizedPosition = this.sanitizeForFilename(jobPosition);

    // Generate timestamp for uniqueness
    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Include confidence score in filename for easy identification
    const scoreCategory = this.getScoreCategory(confidenceScore);

    return `Resume_${sanitizedCompany}_${sanitizedPosition}_${scoreCategory}_${timestamp}.pdf`;
  }

  /**
   * Sanitize string for safe filename usage
   */
  private sanitizeForFilename(input: string): string {
    return input
      .replace(/[^a-zA-Z0-9\s-]/g, '') // Remove special characters
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .replace(/_+/g, '_') // Replace multiple underscores with single
      .replace(/^_|_$/g, '') // Remove leading/trailing underscores
      .slice(0, 30); // Limit length
  }

  /**
   * Get score category for filename
   */
  private getScoreCategory(score: number): string {
    if (score >= 90) return 'Excellent';
    if (score >= 80) return 'VeryGood';
    if (score >= 70) return 'Good';
    if (score >= 60) return 'Fair';
    return 'Basic';
  }

  /**
   * Validate input parameters
   */
  private validateInputs(
    optimizationResult: ResumeOptimizationResult,
    templateId: string,
    companyName: string,
    jobPosition: string,
  ): void {
    if (!optimizationResult || typeof optimizationResult !== 'object') {
      throw new BadRequestException(
        'Optimization result is required and must be an object',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    if (!optimizationResult.optimizedContent) {
      throw new BadRequestException(
        'Optimized content is required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    if (!templateId || typeof templateId !== 'string') {
      throw new BadRequestException(
        'Template ID is required and must be a string',
        ERROR_CODES.INVALID_TEMPLATE_TYPE,
      );
    }

    if (!companyName || typeof companyName !== 'string') {
      throw new BadRequestException(
        'Company name is required and must be a string',
        ERROR_CODES.INVALID_COMPANY_NAME,
      );
    }

    if (!jobPosition || typeof jobPosition !== 'string') {
      throw new BadRequestException(
        'Job position is required and must be a string',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Validate optimization result structure
    if (!optimizationResult.optimizationMetrics) {
      throw new BadRequestException(
        'Optimization metrics are required',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    if (
      typeof optimizationResult.optimizationMetrics.confidenceScore !== 'number'
    ) {
      throw new BadRequestException(
        'Confidence score must be a number',
        ERROR_CODES.BAD_REQUEST,
      );
    }
  }
}
