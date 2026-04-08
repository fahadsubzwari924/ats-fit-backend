import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobAnalysisService } from './job-analysis.service';
import { ResumeContentProcessorService } from './resume-content-processor.service';
import { ResumeOptimizerService } from './resume-optimizer.service';
import { PdfGenerationOrchestratorService } from './pdf-generation-orchestrator.service';
import { ResumeValidationService } from './resume-validation.service';
import { TailoredResumePdfStorageService } from './tailored-resume-pdf-storage.service';
import { ResumeQueueService } from './resume-queue.service';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import {
  ResumeGenerationInput,
  ResumeGenerationResult,
} from '../interfaces/resume-generation.interface';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

/**
 * Resume Generation Orchestrator Service
 *
 * This service orchestrates the complete AI-powered resume generation pipeline
 * using improved architecture, validation, and performance optimizations.
 *
 * Key Responsibilities:
 * - Comprehensive input validation using the validation framework
 * - Orchestrate the complete resume generation pipeline
 */
@Injectable()
export class ResumeGenerationOrchestratorService {
  private readonly logger = new Logger(
    ResumeGenerationOrchestratorService.name,
  );

  constructor(
    private readonly validatorService: ResumeValidationService,
    private readonly jobAnalysisService: JobAnalysisService,
    private readonly resumeContentProcessorService: ResumeContentProcessorService,
    private readonly resumeOptimizerService: ResumeOptimizerService,
    private readonly pdfGenerationOrchestratorService: PdfGenerationOrchestratorService,
    private readonly tailoredResumePdfStorageService: TailoredResumePdfStorageService,
    private readonly resumeQueueService: ResumeQueueService,
    @InjectRepository(ResumeGeneration)
    private readonly resumeGenerationRepository: Repository<ResumeGeneration>,
  ) {}

  /**
   * Execute the complete resume generation pipeline
   */
  async generateOptimizedResume(
    input: ResumeGenerationInput,
  ): Promise<ResumeGenerationResult> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Starting resume generation for ${input.jobPosition} at ${input.companyName}`,
      );

      // STEP 0: Comprehensive upfront validation (FAIL FAST)
      const validationStart = Date.now();
      const validationResult =
        await this.validatorService.validateGenerationRequest(input);
      const validationTime = Date.now() - validationStart;

      if (!validationResult.isValid) {
        this.logger.warn(
          `Validation failed in ${validationTime}ms: ${validationResult.validationErrors.join(', ')}`,
        );
        throw new BadRequestException(
          `Validation failed: ${validationResult.validationErrors.join('; ')}`,
          ERROR_CODES.BAD_REQUEST,
        );
      }

      this.logger.debug(
        `All validations passed in ${validationTime}ms. ` +
          `Template exists: ${validationResult.templateExists}, ` +
          `Has existing resumes: ${validationResult.hasExistingResumes}, ` +
          `Requires file upload: ${validationResult.requiresFileUpload}`,
      );

      // Now proceed with the pipeline - all prerequisites are validated

      // PERFORMANCE OPTIMIZATION: Run independent operations in parallel
      this.logger.debug(
        'Starting parallel job analysis and content processing',
      );
      const parallelOperationsStart = Date.now();

      // Execute job analysis and resume content processing in parallel
      const [jobAnalysis, resumeContent] = await Promise.all([
        // Step 1: Analyze job description using GPT-4 Turbo
        this.jobAnalysisService.analyzeJobDescription(
          input.jobDescription,
          input.jobPosition,
          input.companyName,
        ),
        // Step 2: Process resume content (guest vs registered user handling)
        this.resumeContentProcessorService.processResumeContent(
          input.userContext,
          input.resumeFile,
          input.resumeId,
        ),
      ]);

      const parallelOperationsTime = Date.now() - parallelOperationsStart;

      this.logger.debug(
        `Parallel operations completed in ${parallelOperationsTime}ms. ` +
          `Job analysis found ${jobAnalysis.keywords.primary.length} primary keywords. ` +
          `Content processing used ${resumeContent.source} source.`,
      );

      // Step 3: Optimize resume content using Claude 3.5 Sonnet
      const optimizationStart = Date.now();
      const optimizationResult =
        await this.resumeOptimizerService.optimizeResumeContent(
          jobAnalysis,
          resumeContent.content as TailoredContent,
          input.companyName,
          input.jobPosition,
          resumeContent.tailoringMode,
          resumeContent.verifiedFacts,
        );
      const optimizationTime = Date.now() - optimizationStart;

      this.logger.debug(
        `Content optimization completed in ${optimizationTime}ms. ` +
          `Added ${optimizationResult.optimizationMetrics.keywordsAdded} keywords, ` +
          `confidence: ${optimizationResult.optimizationMetrics.confidenceScore}%`,
      );

      // Step 4: Generate PDF from optimized content
      const pdfGenerationStart = Date.now();
      const pdfResult =
        await this.pdfGenerationOrchestratorService.generateOptimizedResumePdf(
          optimizationResult,
          input.templateId,
          input.companyName,
          input.jobPosition,
        );
      const pdfGenerationTime = Date.now() - pdfGenerationStart;

      this.logger.debug(
        `PDF generation completed in ${pdfGenerationTime}ms. ` +
          `Generated ${pdfResult.generationMetadata.pdfSizeBytes} byte PDF.`,
      );

      // Step 4.5: Save resume generation record and upload PDF to S3
      const dbStart = Date.now();

      const pdfBuffer = Buffer.from(pdfResult.pdfContent, 'base64');
      const pdfS3Key =
        await this.tailoredResumePdfStorageService.uploadGeneratedPdf(
          pdfBuffer,
          input.userContext.userId,
        );

      const savedGeneration = await this.saveResumeGenerationRecord({
        user_id: input.userContext.userId,
        file_path:
          input.resumeFile?.originalname ||
          `resume-${input.resumeId || 'processed'}`,
        original_content: resumeContent.originalText || '',
        tailored_content: optimizationResult.optimizedContent,
        template_id: input.templateId,
        job_description: input.jobDescription,
        company_name: input.companyName,
        job_position: input.jobPosition,
        analysis: optimizationResult.optimizedContent,
        keywords_added: optimizationResult.optimizationMetrics.keywordsAdded,
        sections_optimized:
          optimizationResult.optimizationMetrics.sectionsOptimized,
        achievements_quantified:
          optimizationResult.optimizationMetrics.achievementsQuantified,
        optimization_confidence:
          optimizationResult.optimizationMetrics.confidenceScore,
        pdf_s3_key: pdfS3Key,
        job_analysis: jobAnalysis,
        candidate_content: resumeContent.content,
        changes_diff: null,
      });
      const dbTime = Date.now() - dbStart;

      this.logger.debug(
        `Resume generation record saved in ${dbTime}ms with ID: ${savedGeneration.id}`,
      );

      // Step 5a: Dispatch changes diff computation as a background Bull job.
      // This is fire-and-forget — users get their PDF without waiting.
      void this.resumeQueueService
        .addChangesDiffJob({
          resumeGenerationId: savedGeneration.id,
          userId: input.userContext.userId || '',
          originalContent: resumeContent.content as unknown as Record<
            string,
            unknown
          >,
          optimizedContent:
            optimizationResult.optimizedContent as unknown as Record<
              string,
              unknown
            >,
          jobAnalysisKeywords: {
            mandatorySkills: jobAnalysis.technical.mandatorySkills,
            primaryKeywords: jobAnalysis.keywords.primary,
          },
        })
        .catch((error: unknown) => {
          this.logger.warn(
            '[Background] Changes diff job dispatch failed — diff will be unavailable for this generation',
            error,
          );
        });

      const totalProcessingTime = Date.now() - startTime;

      this.logger.log(
        `Resume generation completed in ${totalProcessingTime}ms ` +
          `(Validation: ${validationTime}ms, Parallel: ${parallelOperationsTime}ms, ` +
          `Optimization: ${optimizationTime}ms, PDF: ${pdfGenerationTime}ms, DB: ${dbTime}ms, Diff: background)`,
      );

      // Build comprehensive result — ATS score available after background task completes
      return {
        // Primary outputs
        pdfContent: pdfResult.pdfContent,
        filename: pdfResult.filename,

        // Generation tracking
        resumeGenerationId: savedGeneration.id,

        // Optimization metrics
        keywordsAdded: optimizationResult.optimizationMetrics.keywordsAdded,
        sectionsOptimized:
          optimizationResult.optimizationMetrics.sectionsOptimized,
        achievementsQuantified:
          optimizationResult.optimizationMetrics.achievementsQuantified,
        optimizationConfidence:
          optimizationResult.optimizationMetrics.confidenceScore,

        // Processing metadata
        processingMetrics: {
          validationTimeMs: validationTime,
          parallelOperationsTimeMs: parallelOperationsTime,
          optimizationTimeMs: optimizationTime,
          pdfGenerationTimeMs: pdfGenerationTime,
          dbSaveTimeMs: dbTime,
          totalProcessingTimeMs: totalProcessingTime,
        },
        contentSource: resumeContent.source,
        tailoringMode: resumeContent.tailoringMode,

        // PDF metadata
        pdfSizeBytes: pdfResult.generationMetadata.pdfSizeBytes,
        templateUsed: input.templateId,

        // Job analysis insights
        primaryKeywordsFound: jobAnalysis.keywords.primary.length,
        mandatorySkillsAligned: jobAnalysis.technical.mandatorySkills.length,
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(
        `Resume generation failed after ${processingTime}ms`,
        error,
      );

      // Re-throw known business exceptions as-is
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      // Handle specific AI service failures
      if (
        error instanceof Error &&
        (error.message.includes('timeout') ||
          error.message.includes('AI service') ||
          error.message.includes('Claude') ||
          error.message.includes('OpenAI') ||
          error.message.includes('GPT'))
      ) {
        throw new InternalServerErrorException(
          'AI processing services are temporarily unavailable. Please try again in a few moments.',
          ERROR_CODES.INTERNAL_SERVER,
        );
      }

      // Handle PDF generation failures
      if (
        error instanceof Error &&
        (error.message.includes('PDF') || error.message.includes('template'))
      ) {
        throw new InternalServerErrorException(
          'PDF generation failed. Please check your template selection and try again.',
          ERROR_CODES.PROMPT_GENERATION_FAILED,
        );
      }

      // Handle any unexpected errors
      throw new InternalServerErrorException(
        'Resume generation failed due to an internal error. Please try again or contact support if the issue persists.',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Save resume generation record following V1 pattern
   * This creates a database record to track the resume generation
   */
  private async saveResumeGenerationRecord(
    payload: Partial<ResumeGeneration>,
  ): Promise<ResumeGeneration> {
    try {
      const resumeGeneration = this.resumeGenerationRepository.create(payload);
      return await this.resumeGenerationRepository.save(resumeGeneration);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown database error';
      this.logger.error('Failed to save resume generation record', {
        error: errorMessage,
        payload: {
          user_id: payload.user_id,
          template_id: payload.template_id,
          company_name: payload.company_name,
        },
      });

      throw new InternalServerErrorException(
        'Failed to save resume generation record. Please try again or contact support if the issue persists.',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }
}
