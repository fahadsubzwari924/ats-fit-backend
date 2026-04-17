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
import { AtsChecksComputationService } from './ats-checks-computation.service';
import { BulletsQuantifiedComputationService } from './bullets-quantified-computation.service';
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
import { MATCH_SCORE_MAX_PERCENTAGE } from '../../../shared/constants/resume-tailoring.constants';

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
    private readonly atsChecksComputationService: AtsChecksComputationService,
    private readonly bulletsQuantifiedComputationService: BulletsQuantifiedComputationService,
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

      const validationTime = await this.runValidation(input);
      const { jobAnalysis, resumeContent, parallelOperationsTime } =
        await this.runAnalysisAndProcessing(input);
      const { optimizationResult, optimizationTime } =
        await this.runOptimization(input, jobAnalysis, resumeContent);
      const scores = this.computeScores(
        jobAnalysis,
        resumeContent,
        optimizationResult,
      );
      const { pdfResult, pdfGenerationTime } = await this.runPdfGeneration(
        input,
        optimizationResult,
      );
      const { savedGeneration, dbTime } = await this.persistGeneration(
        input,
        resumeContent,
        optimizationResult,
        pdfResult,
        jobAnalysis,
        scores,
      );

      this.dispatchDiffJob(
        savedGeneration.id,
        input,
        resumeContent,
        optimizationResult,
        jobAnalysis,
      );

      const totalProcessingTime = Date.now() - startTime;
      this.logger.log(
        `Resume generation completed in ${totalProcessingTime}ms ` +
          `(Validation: ${validationTime}ms, Parallel: ${parallelOperationsTime}ms, ` +
          `Optimization: ${optimizationTime}ms, PDF: ${pdfGenerationTime}ms, DB: ${dbTime}ms, Diff: background)`,
      );

      return this.buildResult(
        input,
        pdfResult,
        savedGeneration,
        resumeContent,
        optimizationResult,
        jobAnalysis,
        scores,
        {
          validationTime,
          parallelOperationsTime,
          optimizationTime,
          pdfGenerationTime,
          dbTime,
          totalProcessingTime,
        },
      );
    } catch (error) {
      this.handlePipelineError(error, Date.now() - startTime);
    }
  }

  // ---------------------------------------------------------------------------
  // Pipeline steps
  // ---------------------------------------------------------------------------

  private async runValidation(input: ResumeGenerationInput): Promise<number> {
    const start = Date.now();
    const validationResult =
      await this.validatorService.validateGenerationRequest(input);
    const elapsed = Date.now() - start;

    if (!validationResult.isValid) {
      this.logger.warn(
        `Validation failed in ${elapsed}ms: ${validationResult.validationErrors.join(', ')}`,
      );
      throw new BadRequestException(
        `Validation failed: ${validationResult.validationErrors.join('; ')}`,
        ERROR_CODES.BAD_REQUEST,
      );
    }

    this.logger.debug(
      `All validations passed in ${elapsed}ms. ` +
        `Template exists: ${validationResult.templateExists}, ` +
        `Has existing resumes: ${validationResult.hasExistingResumes}, ` +
        `Requires file upload: ${validationResult.requiresFileUpload}`,
    );

    return elapsed;
  }

  private async runAnalysisAndProcessing(input: ResumeGenerationInput) {
    this.logger.debug('Starting parallel job analysis and content processing');
    const start = Date.now();

    const [jobAnalysis, resumeContent] = await Promise.all([
      this.jobAnalysisService.analyzeJobDescription(
        input.jobDescription,
        input.jobPosition,
        input.companyName,
      ),
      this.resumeContentProcessorService.processResumeContent(
        input.userContext,
        input.resumeFile,
        input.resumeId,
      ),
    ]);

    const parallelOperationsTime = Date.now() - start;
    this.logger.debug(
      `Parallel operations completed in ${parallelOperationsTime}ms. ` +
        `Job analysis found ${jobAnalysis.keywords.primary.length} primary keywords. ` +
        `Content processing used ${resumeContent.source} source.`,
    );

    return { jobAnalysis, resumeContent, parallelOperationsTime };
  }

  private async runOptimization(
    input: ResumeGenerationInput,
    jobAnalysis: Awaited<
      ReturnType<typeof this.jobAnalysisService.analyzeJobDescription>
    >,
    resumeContent: Awaited<
      ReturnType<typeof this.resumeContentProcessorService.processResumeContent>
    >,
  ) {
    const start = Date.now();
    const optimizationResult =
      await this.resumeOptimizerService.optimizeResumeContent(
        jobAnalysis,
        resumeContent.content as TailoredContent,
        input.companyName,
        input.jobPosition,
        resumeContent.tailoringMode,
        resumeContent.verifiedFacts,
      );
    const optimizationTime = Date.now() - start;

    this.logger.debug(
      `Content optimization completed in ${optimizationTime}ms. ` +
        `Added ${optimizationResult.optimizationMetrics.keywordsAdded} keywords, ` +
        `confidence: ${optimizationResult.optimizationMetrics.confidenceScore}%`,
    );

    return { optimizationResult, optimizationTime };
  }

  private computeScores(
    jobAnalysis: Awaited<
      ReturnType<typeof this.jobAnalysisService.analyzeJobDescription>
    >,
    resumeContent: Awaited<
      ReturnType<typeof this.resumeContentProcessorService.processResumeContent>
    >,
    optimizationResult: Awaited<
      ReturnType<typeof this.resumeOptimizerService.optimizeResumeContent>
    >,
  ) {
    const targetKeywords: string[] = [
      ...jobAnalysis.keywords.primary,
      ...jobAnalysis.technical.mandatorySkills,
    ];

    const matchScoreBefore = this.computeKeywordMatchScore(
      resumeContent.rawContent as TailoredContent,
      targetKeywords,
    );
    const matchScoreAfter = this.computeKeywordMatchScore(
      optimizationResult.optimizedContent,
      targetKeywords,
    );
    const matchScoreDelta = matchScoreAfter - matchScoreBefore;

    this.logger.debug(
      `Keyword match scores — before: ${matchScoreBefore}%, after: ${matchScoreAfter}%, delta: ${matchScoreDelta}%`,
    );

    const atsChecks = this.atsChecksComputationService.computeChecks(
      optimizationResult.optimizedContent,
    );
    const bulletsQuantified =
      this.bulletsQuantifiedComputationService.computeQuantified(
        resumeContent.rawContent as TailoredContent,
        optimizationResult.optimizedContent,
      );

    this.logger.debug(
      `ATS checks: ${atsChecks.passed}/${atsChecks.total} passed. ` +
        `Quantified bullets — before: ${bulletsQuantified.before}, after: ${bulletsQuantified.after}, total: ${bulletsQuantified.total}`,
    );

    return {
      matchScoreBefore,
      matchScoreAfter,
      matchScoreDelta,
      atsChecks,
      bulletsQuantified,
    };
  }

  private async runPdfGeneration(
    input: ResumeGenerationInput,
    optimizationResult: Awaited<
      ReturnType<typeof this.resumeOptimizerService.optimizeResumeContent>
    >,
  ) {
    const start = Date.now();
    const pdfResult =
      await this.pdfGenerationOrchestratorService.generateOptimizedResumePdf(
        optimizationResult,
        input.templateId,
        input.companyName,
        input.jobPosition,
      );
    const pdfGenerationTime = Date.now() - start;

    this.logger.debug(
      `PDF generation completed in ${pdfGenerationTime}ms. ` +
        `Generated ${pdfResult.generationMetadata.pdfSizeBytes} byte PDF.`,
    );

    return { pdfResult, pdfGenerationTime };
  }

  private async persistGeneration(
    input: ResumeGenerationInput,
    resumeContent: Awaited<
      ReturnType<typeof this.resumeContentProcessorService.processResumeContent>
    >,
    optimizationResult: Awaited<
      ReturnType<typeof this.resumeOptimizerService.optimizeResumeContent>
    >,
    pdfResult: Awaited<
      ReturnType<
        typeof this.pdfGenerationOrchestratorService.generateOptimizedResumePdf
      >
    >,
    jobAnalysis: Awaited<
      ReturnType<typeof this.jobAnalysisService.analyzeJobDescription>
    >,
    scores: ReturnType<typeof this.computeScores>,
  ) {
    const start = Date.now();

    const pdfBuffer = Buffer.from(pdfResult.pdfContent, 'base64');
    const pdfS3Key =
      await this.tailoredResumePdfStorageService.uploadGeneratedPdf(
        pdfBuffer,
        input.userContext.userId,
      );

    const { matchScoreBefore, matchScoreAfter, atsChecks, bulletsQuantified } =
      scores;

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
      candidate_content: resumeContent.content as unknown as Record<
        string,
        unknown
      >,
      changes_diff: null,
      atsChecksPassed: atsChecks.passed,
      atsChecksTotal: atsChecks.total,
      bulletsQuantifiedBefore: bulletsQuantified.before,
      bulletsQuantifiedAfter: bulletsQuantified.after,
      matchScoreBefore,
      matchScoreAfter,
    });

    const dbTime = Date.now() - start;
    this.logger.debug(
      `Resume generation record saved in ${dbTime}ms with ID: ${savedGeneration.id}`,
    );

    return { savedGeneration, dbTime };
  }

  private dispatchDiffJob(
    resumeGenerationId: string,
    input: ResumeGenerationInput,
    resumeContent: Awaited<
      ReturnType<typeof this.resumeContentProcessorService.processResumeContent>
    >,
    optimizationResult: Awaited<
      ReturnType<typeof this.resumeOptimizerService.optimizeResumeContent>
    >,
    jobAnalysis: Awaited<
      ReturnType<typeof this.jobAnalysisService.analyzeJobDescription>
    >,
  ): void {
    void this.resumeQueueService
      .addChangesDiffJob({
        resumeGenerationId,
        userId: input.userContext.userId || '',
        originalContent: resumeContent.rawContent as unknown as Record<
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
  }

  private buildResult(
    input: ResumeGenerationInput,
    pdfResult: Awaited<
      ReturnType<
        typeof this.pdfGenerationOrchestratorService.generateOptimizedResumePdf
      >
    >,
    savedGeneration: ResumeGeneration,
    resumeContent: Awaited<
      ReturnType<typeof this.resumeContentProcessorService.processResumeContent>
    >,
    optimizationResult: Awaited<
      ReturnType<typeof this.resumeOptimizerService.optimizeResumeContent>
    >,
    jobAnalysis: Awaited<
      ReturnType<typeof this.jobAnalysisService.analyzeJobDescription>
    >,
    scores: ReturnType<typeof this.computeScores>,
    timings: {
      validationTime: number;
      parallelOperationsTime: number;
      optimizationTime: number;
      pdfGenerationTime: number;
      dbTime: number;
      totalProcessingTime: number;
    },
  ): ResumeGenerationResult {
    const {
      matchScoreBefore,
      matchScoreAfter,
      matchScoreDelta,
      atsChecks,
      bulletsQuantified,
    } = scores;

    return {
      pdfContent: pdfResult.pdfContent,
      filename: pdfResult.filename,
      resumeGenerationId: savedGeneration.id,
      keywordsAdded: optimizationResult.optimizationMetrics.keywordsAdded,
      sectionsOptimized:
        optimizationResult.optimizationMetrics.sectionsOptimized,
      achievementsQuantified:
        optimizationResult.optimizationMetrics.achievementsQuantified,
      optimizationConfidence:
        optimizationResult.optimizationMetrics.confidenceScore,
      processingMetrics: {
        validationTimeMs: timings.validationTime,
        parallelOperationsTimeMs: timings.parallelOperationsTime,
        optimizationTimeMs: timings.optimizationTime,
        pdfGenerationTimeMs: timings.pdfGenerationTime,
        dbSaveTimeMs: timings.dbTime,
        totalProcessingTimeMs: timings.totalProcessingTime,
      },
      contentSource: resumeContent.source,
      tailoringMode: resumeContent.tailoringMode,
      pdfSizeBytes: pdfResult.generationMetadata.pdfSizeBytes,
      templateUsed: input.templateId,
      primaryKeywordsFound: jobAnalysis.keywords.primary.length,
      mandatorySkillsAligned: jobAnalysis.technical.mandatorySkills.length,
      matchScoreBefore,
      matchScoreAfter,
      matchScoreDelta,
      atsChecksPassed: atsChecks.passed,
      atsChecksTotal: atsChecks.total,
      bulletsQuantifiedBefore: bulletsQuantified.before,
      bulletsQuantifiedAfter: bulletsQuantified.after,
      bulletsQuantifiedTotal: bulletsQuantified.total,
    };
  }

  private handlePipelineError(error: unknown, processingTime: number): never {
    this.logger.error(
      `Resume generation failed after ${processingTime}ms`,
      error,
    );

    if (
      error instanceof BadRequestException ||
      error instanceof NotFoundException
    ) {
      throw error;
    }

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

    if (
      error instanceof Error &&
      (error.message.includes('PDF') || error.message.includes('template'))
    ) {
      throw new InternalServerErrorException(
        'PDF generation failed. Please check your template selection and try again.',
        ERROR_CODES.PROMPT_GENERATION_FAILED,
      );
    }

    throw new InternalServerErrorException(
      'Resume generation failed due to an internal error. Please try again or contact support if the issue persists.',
      ERROR_CODES.INTERNAL_SERVER,
    );
  }

  /**
   * Flatten a TailoredContent object into a single lowercased string
   * for keyword matching purposes.
   */
  private contentToText(content: TailoredContent): string {
    if (!content) return '';

    const parts: string[] = [];

    if (content.title) parts.push(content.title);
    if (content.summary) parts.push(content.summary);

    if (content.skills) {
      const { languages, frameworks, tools, databases, concepts } =
        content.skills;
      parts.push(
        ...(languages ?? []),
        ...(frameworks ?? []),
        ...(tools ?? []),
        ...(databases ?? []),
        ...(concepts ?? []),
      );
    }

    for (const exp of content.experience ?? []) {
      if (exp.position) parts.push(exp.position);
      parts.push(...(exp.responsibilities ?? []));
      parts.push(...(exp.achievements ?? []));
      if (exp.technologies) parts.push(exp.technologies);
    }

    for (const edu of content.education ?? []) {
      if (edu.degree) parts.push(edu.degree);
      if (edu.institution) parts.push(edu.institution);
    }

    for (const cert of content.certifications ?? []) {
      if (cert.name) parts.push(cert.name);
    }

    return parts.join(' ').toLowerCase();
  }

  /**
   * Compute the percentage of keywords found (case-insensitive substring match)
   * in the given TailoredContent. Result is capped at 95 and rounded to the
   * nearest integer.
   */
  private computeKeywordMatchScore(
    content: TailoredContent,
    keywords: string[],
  ): number {
    if (!keywords || keywords.length === 0) return 0;

    const text = this.contentToText(content);
    const uniqueKeywords = [...new Set(keywords.map((k) => k.toLowerCase()))];

    const matchedCount = uniqueKeywords.filter((kw) =>
      text.includes(kw),
    ).length;
    const raw = (matchedCount / uniqueKeywords.length) * 100;

    return Math.min(MATCH_SCORE_MAX_PERCENTAGE, Math.round(raw));
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
