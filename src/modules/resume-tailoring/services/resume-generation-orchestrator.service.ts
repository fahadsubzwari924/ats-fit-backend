import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobRelevanceService } from '../../job-relevance/job-relevance.service';
import { JobRelevanceVerdict } from '../../job-relevance/enums/job-relevance-verdict.enum';
import type { JobRelevanceProfileSource } from '../../job-relevance/interfaces/job-relevance-input.interface';
import type { JobRelevanceResult } from '../../job-relevance/interfaces/job-relevance.interface';
import { ResumeProfileEnrichmentService } from './resume-profile-enrichment.service';
import { JobAnalysisService } from './job-analysis.service';
import { ResumeContentProcessorService } from './resume-content-processor.service';
import { ResumeOptimizerService } from './resume-optimizer.service';
import { PdfGenerationOrchestratorService } from './pdf-generation-orchestrator.service';
import { ResumeValidationService } from './resume-validation.service';
import { TailoredResumePdfStorageService } from './tailored-resume-pdf-storage.service';
import { AtsChecksComputationService } from './ats-checks-computation.service';
import { BulletsQuantifiedComputationService } from './bullets-quantified-computation.service';
import { ChangesDiffComputationService } from './changes-diff-computation.service';
import { ResumeGeneration } from '../../../database/entities/resume-generations.entity';
import { User } from '../../../database/entities/user.entity';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import { EnhancedResumeDiff } from '../interfaces/enhanced-resume-diff.interface';
import {
  ResumeGenerationInput,
  ResumeGenerationResult,
} from '../interfaces/resume-generation.interface';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';
import { OPTIMIZATION_PROMPT_VERSION } from '../../../shared/constants/prompt-versions.constants';
import { ResumeContentService } from './resume-content.service';
import { ResumeReplacementErrorCode } from '../../../shared/enums/resume-replacement.enum';
import { KeywordMatchScoringService } from './keyword-match-scoring.service';
import { MatchScoreClassifierService } from './match-score-classifier.service';

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
    private readonly atsChecksComputationService: AtsChecksComputationService,
    private readonly bulletsQuantifiedComputationService: BulletsQuantifiedComputationService,
    private readonly changesDiffComputationService: ChangesDiffComputationService,
    private readonly resumeContentService: ResumeContentService,
    private readonly keywordMatchScoringService: KeywordMatchScoringService,
    private readonly matchScoreClassifierService: MatchScoreClassifierService,
    @Inject(forwardRef(() => JobRelevanceService))
    private readonly jobRelevanceService: JobRelevanceService,
    private readonly resumeProfileEnrichmentService: ResumeProfileEnrichmentService,
    @InjectRepository(ResumeGeneration)
    private readonly resumeGenerationRepository: Repository<ResumeGeneration>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Execute the complete resume generation pipeline
   */
  async generateOptimizedResume(
    input: ResumeGenerationInput,
  ): Promise<ResumeGenerationResult> {
    this.logger.log(
      `Starting resume generation for ${input.jobPosition} at ${input.companyName}`,
    );

    const abortController = new AbortController();

    const relevancePromise = this.resolveRelevanceProfile(input).then(
      (profile) =>
        this.jobRelevanceService.score({
          userId: input.userContext?.userId ?? null,
          profile,
          jobPosition: input.jobPosition,
          companyName: input.companyName,
          jobDescription: input.jobDescription,
          abortSignal: abortController.signal,
        }),
    );

    const tailorPromise = this.runTailoringPipeline(
      input,
      abortController.signal,
    ).catch((err: Error): ResumeGenerationResult | null => {
      if (err.name === 'AbortError') return null;
      throw err;
    });

    const relevance = await relevancePromise;

    const isLowFit =
      relevance.verdict === JobRelevanceVerdict.LOW && !input.acknowledgeLowFit;

    if (isLowFit) {
      abortController.abort();
      await tailorPromise;
      this.logger.log(
        `[JobRelevance] Aborted tailor — score=${relevance.score} verdict=${relevance.verdict} ack=false`,
      );
      return { kind: 'low_fit_warning', relevance };
    }

    const tailorOutcome = await tailorPromise;

    if (!tailorOutcome) {
      throw new InternalServerErrorException(
        'Tailor pipeline produced no result after relevance check passed',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    if (tailorOutcome.kind !== 'pdf') {
      throw new InternalServerErrorException(
        'Unexpected non-pdf result from tailor pipeline',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }

    // Persist relevance onto saved generation
    if (tailorOutcome.resumeGenerationId) {
      await this.resumeGenerationRepository.update(
        { id: tailorOutcome.resumeGenerationId },
        {
          preGenerationRelevance: {
            ...relevance,
            acknowledgedLowFit: !!input.acknowledgeLowFit,
          },
        },
      );
    }

    return { ...tailorOutcome, relevance };
  }

  /**
   * Standalone relevance check — runs ONLY the relevance scoring pass, without
   * touching the tailoring pipeline. Used by the new two-step UX where the
   * client previews job fit before deciding whether to spend quota on a full
   * tailor.
   *
   * The result is cached in Redis under the same key as the full flow uses,
   * so when the client subsequently calls /generate the relevance step there
   * is a cache hit (no second LLM call, no extra latency).
   *
   * No DB persistence happens here — relevance is only saved to the
   * `resume_generations` row when an actual tailored resume is produced.
   */
  async checkRelevanceOnly(
    input: ResumeGenerationInput,
  ): Promise<JobRelevanceResult> {
    const profile = await this.resolveRelevanceProfile(input);
    return this.jobRelevanceService.score({
      userId: input.userContext?.userId ?? null,
      profile,
      jobPosition: input.jobPosition,
      companyName: input.companyName,
      jobDescription: input.jobDescription,
    });
  }

  // ---------------------------------------------------------------------------
  // Relevance helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a `JobRelevanceProfileSource` for scoring.
   *
   * Resolution order — prefer the richest signal we have:
   *   1. `enriched_resume_profiles` — has Q&A-derived facts and verified
   *      achievements; gives Haiku the most accurate context.
   *   2. `extracted_resume_contents.structuredContent` — the JSON-parsed
   *      resume from the upload step. Used when the user uploaded a resume
   *      but never completed enrichment (a common state — onboarding doesn't
   *      force enrichment). Without this fallback, those users hit the
   *      UNAVAILABLE sentinel even though we have plenty of content to score.
   *   3. `extracted_resume_contents.extractedText` — raw text fallback when
   *      structured content somehow ended up null.
   *   4. `{ kind: 'none' }` — truly nothing on file; the service returns the
   *      UNAVAILABLE sentinel with reason NO_PROFILE.
   *
   * Skipped entirely when the user uploaded a resume file with this request
   * (`input.resumeFile` present) — that means they're using a one-off upload
   * and we don't want to score against their old persisted profile.
   */
  private async resolveRelevanceProfile(
    input: ResumeGenerationInput,
  ): Promise<JobRelevanceProfileSource> {
    if (!input.userContext?.userId || input.resumeFile) {
      return { kind: 'none' };
    }
    const userId = input.userContext.userId;

    const enriched =
      await this.resumeProfileEnrichmentService.getProfileForUser(userId);
    if (enriched) {
      return {
        kind: 'enriched',
        profileVersion: enriched.version,
        content: enriched.enrichedContent,
      };
    }

    const extracted =
      await this.resumeContentService.getActiveExtractedContent(userId);
    if (extracted?.structuredContent) {
      return { kind: 'extracted', content: extracted.structuredContent };
    }
    if (extracted?.extractedText?.trim()) {
      return { kind: 'raw-text', text: extracted.extractedText };
    }

    return { kind: 'none' };
  }

  private throwIfAborted(signal: AbortSignal, context: string): void {
    if (signal.aborted) {
      const err = new Error(`Tailor pipeline aborted at: ${context}`);
      err.name = 'AbortError';
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Tailoring pipeline (extracted from generateOptimizedResume)
  // ---------------------------------------------------------------------------

  private async runTailoringPipeline(
    input: ResumeGenerationInput,
    signal: AbortSignal,
  ): Promise<ResumeGenerationResult> {
    const startTime = Date.now();

    if (!input.resumeFile) {
      await this.assertProfileReady(input.userContext.userId);
    }
    this.throwIfAborted(signal, 'pre-validation');

    const validationTime = await this.runValidation(input);
    this.throwIfAborted(signal, 'post-validation');

    const { jobAnalysis, resumeContent, parallelOperationsTime } =
      await this.runAnalysisAndProcessing(input);
    this.throwIfAborted(signal, 'post-analysis');

    const { optimizationResult, optimizationTime } = await this.runOptimization(
      input,
      jobAnalysis,
      resumeContent,
    );
    this.throwIfAborted(signal, 'post-optimization');

    const scores = this.computeScores(
      jobAnalysis,
      resumeContent,
      optimizationResult,
    );
    this.throwIfAborted(signal, 'pre-pdf');

    const { pdfResult, pdfGenerationTime } = await this.runPdfGeneration(
      input,
      optimizationResult,
    );
    this.throwIfAborted(signal, 'post-pdf');

    const diff = this.changesDiffComputationService.computeDiff(
      resumeContent.content as unknown as TailoredContent,
      optimizationResult.optimizedContent,
      {
        mandatorySkills: jobAnalysis.technical.mandatorySkills,
        primaryKeywords: jobAnalysis.keywords.primary,
      },
      {
        originalText: resumeContent.originalText,
        jobAnalysis,
      },
    );

    const { savedGeneration, dbTime } = await this.persistGeneration(
      input,
      resumeContent,
      optimizationResult,
      pdfResult,
      jobAnalysis,
      scores,
      diff,
    );

    const totalProcessingTime = Date.now() - startTime;
    this.logger.log(
      `Resume generation completed in ${totalProcessingTime}ms ` +
        `(Validation: ${validationTime}ms, Parallel: ${parallelOperationsTime}ms, ` +
        `Optimization: ${optimizationTime}ms, PDF: ${pdfGenerationTime}ms, DB: ${dbTime}ms, Diff: inline)`,
    );

    return this.buildResult(
      input,
      pdfResult,
      savedGeneration,
      resumeContent,
      optimizationResult,
      jobAnalysis,
      scores,
      diff,
      {
        validationTime,
        parallelOperationsTime,
        optimizationTime,
        pdfGenerationTime,
        dbTime,
        totalProcessingTime,
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Pipeline steps
  // ---------------------------------------------------------------------------

  /**
   * Look up the account holder's full name so we can brand the generated PDF
   * with the user's identity rather than whatever name the AI extracted from
   * the uploaded resume content. Empty string is returned (not an error) when
   * the user record cannot be found — the PDF orchestrator falls back to the
   * resume's contactInfo.name in that case so the file still has a sensible
   * filename.
   */
  private async resolveAccountFullName(userId?: string): Promise<string> {
    if (!userId) return '';
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['full_name'],
    });
    return user?.full_name ?? '';
  }

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
        input.userContext.userId,
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
    // Single shared keyword-set builder (mirrors the diff service's call site)
    // so before/after scores never drift due to divergent keyword construction.
    const keywordSet = KeywordMatchScoringService.buildKeywordSet(jobAnalysis);

    // BEFORE score: scored against the user's literal uploaded text only.
    // `applyAliases: false` enforces the ATS-literal-scanner view —
    // no UNIVERSAL_ALIAS_MAP, no per-keyword JD aliases, no candidate-side
    // alias expansion. If `originalText` is missing (legacy paths) fall back
    // to flattened `rawContent` and warn so we can hunt the gap down.
    const beforeSource = resumeContent.originalText;
    if (!beforeSource) {
      this.logger.warn(
        'originalText missing; falling back to rawContent for before-score',
        {
          resumeContentSource: resumeContent.source,
        },
      );
    }
    const matchScoreBefore = this.keywordMatchScoringService.computeScore(
      beforeSource ?? (resumeContent.rawContent as TailoredContent),
      keywordSet,
      undefined,
      { applyAliases: false },
    );

    // AFTER score: full alias machinery (Layer 1 + Layer 2 + Layer 3) against
    // the structured optimized content. Candidate skill aliases come from the
    // optimized content (skillAliases is preserved through optimization).
    const matchScoreAfter = this.keywordMatchScoringService.computeScore(
      optimizationResult.optimizedContent,
      keywordSet,
      optimizationResult.optimizedContent.skillAliases,
      { applyAliases: true },
    );
    const matchScoreDelta = matchScoreAfter - matchScoreBefore;

    this.logger.debug(
      `Keyword match scores — before: ${matchScoreBefore}%, after: ${matchScoreAfter}%, delta: ${matchScoreDelta}%`,
    );

    // Canonical block — single source of truth broadcast to every API surface.
    const matchScoreBlock = this.matchScoreClassifierService.classify(
      matchScoreBefore,
      matchScoreAfter,
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
      // Flat fields kept for one transition cycle — TODO: remove after FE
      // migration lands and all consumers read from `matchScoreBlock`.
      matchScoreBefore,
      matchScoreAfter,
      matchScoreDelta,
      matchScoreBlock,
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
    const candidateName = await this.resolveAccountFullName(
      input.userContext.userId,
    );
    const pdfResult =
      await this.pdfGenerationOrchestratorService.generateOptimizedResumePdf(
        optimizationResult,
        input.templateId,
        input.companyName,
        input.jobPosition,
        candidateName,
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
    diff: EnhancedResumeDiff,
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

    const computedKeywordsAdded = diff.keywordAnalysis.newlyAdded.length;

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
      keywords_added: computedKeywordsAdded,
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
      changes_diff: diff as unknown as Record<string, unknown>,
      prompt_version: OPTIMIZATION_PROMPT_VERSION,
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
    diff: EnhancedResumeDiff,
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
      matchScoreBlock,
      atsChecks,
      bulletsQuantified,
    } = scores;

    const keywordsAdded = diff.keywordAnalysis.newlyAdded.length;
    const sectionsChanged = diff.sectionsChanged;

    return {
      kind: 'pdf' as const,
      pdfContent: pdfResult.pdfContent,
      filename: pdfResult.filename,
      resumeGenerationId: savedGeneration.id,
      keywordsAdded,
      sectionsChanged,
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
      // Canonical block — broadcast to every API surface as the single
      // source of truth for FE rendering.
      matchScore: matchScoreBlock,
      // Flat fields retained for one transition cycle. TODO: remove after FE
      // migration lands and all consumers read `matchScore` instead.
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

  private async assertProfileReady(userId: string): Promise<void> {
    const ready = await this.resumeContentService.hasProcessedResume(userId);
    if (!ready) {
      throw new ConflictException({
        code: ResumeReplacementErrorCode.RESUME_PROFILE_NOT_READY,
        message: 'Your resume is still processing. Please wait and try again.',
      });
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
