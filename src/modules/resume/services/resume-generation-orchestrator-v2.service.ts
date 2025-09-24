import { Injectable, Logger } from '@nestjs/common';
import { JobDescriptionAnalysisService } from './job-description-analysis.service';
import { ResumeContentProcessorService } from './resume-content-processor.service';
import { AIResumeOptimizerService } from './ai-resume-optimizer.service';
import { PdfGenerationOrchestratorService } from './pdf-generation-orchestrator.service';
import { ResumeGenerationValidatorService } from './resume-generation-validator.service';
import { AtsEvaluationService } from '../../../shared/services/ats-evaluation.service';
import { PromptService } from '../../../shared/services/prompt.service';
import { AIService } from './ai.service';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import {
  ResumeGenerationV2Input,
  ResumeGenerationV2Result,
} from '../interfaces/resume-generation-v2.interface';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

/**
 * Resume Generation Orchestrator V2 Service
 *
 * This service orchestrates the complex multi-step process of generating
 * an AI-optimized, ATS-scored resume. It coordinates between multiple
 * specialized services while providing comprehensive metrics and error handling.
 *
 * Key Responsibilities:
 * - Orchestrate the complete V2 resume generation pipeline
 * - Handle timing and performance metrics for each step
 * - Provide detailed error handling and recovery strategies
 * - Convert between different data formats as needed
 * - Ensure proper sequencing and data flow between services
 *
 * This service removes the orchestration complexity from the controller,
 * allowing the controller to focus solely on HTTP concerns.
 */
@Injectable()
export class ResumeGenerationOrchestratorV2Service {
  private readonly logger = new Logger(
    ResumeGenerationOrchestratorV2Service.name,
  );

  constructor(
    private readonly validatorService: ResumeGenerationValidatorService,
    private readonly jobDescriptionAnalysisService: JobDescriptionAnalysisService,
    private readonly resumeContentProcessorService: ResumeContentProcessorService,
    private readonly aiResumeOptimizerService: AIResumeOptimizerService,
    private readonly pdfGenerationOrchestratorService: PdfGenerationOrchestratorService,
    private readonly atsEvaluationService: AtsEvaluationService,
    private readonly promptService: PromptService,
    private readonly aiService: AIService,
  ) {}

  /**
   * Execute the complete V2 resume generation pipeline
   */
  async generateOptimizedResume(
    input: ResumeGenerationV2Input,
  ): Promise<ResumeGenerationV2Result> {
    const startTime = Date.now();

    try {
      this.logger.log(
        `Starting V2 resume generation for ${input.jobPosition} at ${input.companyName}`,
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
        this.jobDescriptionAnalysisService.analyzeJobDescription(
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
        await this.aiResumeOptimizerService.optimizeResumeContent(
          jobAnalysis,
          resumeContent.content as TailoredContent,
          input.companyName,
          input.jobPosition,
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

      // Step 5: Start ATS evaluation in background (non-blocking)
      const atsEvaluationStart = Date.now();

      // Convert structured content to text for ATS evaluation
      const resumeTextForAts = this.convertOptimizedContentToText(
        optimizationResult.optimizedContent,
      );

      // PERFORMANCE OPTIMIZATION: Start ATS evaluation in background
      // This allows us to return the PDF immediately while ATS processing continues
      const atsEvaluationPromise =
        this.atsEvaluationService.performAtsEvaluation(
          input.jobDescription,
          resumeTextForAts,
          this.promptService,
          this.aiService,
          {
            userId: input.userContext.userId,
            guestId: input.userContext.guestId,
          },
          {
            companyName: input.companyName,
            resumeContent: resumeTextForAts,
          },
        );

      // For immediate response, use cached/estimated values if available
      interface AtsEvaluationInterface {
        overallScore: number;
        confidence: number;
        detailedBreakdown: any;
      }

      let atsEvaluation: AtsEvaluationInterface;
      let atsMatchHistoryId: string;
      let atsEvaluationTime: number;

      // Check if we have a quick cached result (with timeout)
      try {
        const quickResult = await Promise.race([
          atsEvaluationPromise,
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('ATS timeout')),
              45000, // 45 second timeout to allow for Claude overload + OpenAI fallback
            ),
          ),
        ]);

        const result = quickResult as {
          evaluation: {
            overallScore: number;
            confidence: number;
            detailedBreakdown: any;
          };
          atsMatchHistoryId: string;
        };

        atsEvaluation = result.evaluation;
        atsMatchHistoryId = result.atsMatchHistoryId;
        atsEvaluationTime = Date.now() - atsEvaluationStart;

        this.logger.debug(
          `ATS evaluation completed quickly in ${atsEvaluationTime}ms. ` +
            `Overall score: ${atsEvaluation.overallScore}%, ` +
            `Confidence: ${atsEvaluation.confidence}%`,
        );
      } catch (error) {
        // ATS evaluation failed or timed out - throw proper error
        atsEvaluationTime = 5000; // Timeout time
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Unknown ATS evaluation error';

        this.logger.error('ATS evaluation failed or timed out', {
          error: errorMessage,
          userId: input.userContext.userId,
          guestId: input.userContext.guestId,
          timeoutMs: 45000,
        });

        // Throw proper error instead of returning fake data
        throw new Error(
          `ATS evaluation failed: ${errorMessage}. Please try again or contact support if the issue persists.`,
        );
      }

      const totalProcessingTime = Date.now() - startTime;

      this.logger.log(
        `V2 resume generation completed successfully in ${totalProcessingTime}ms ` +
          `(Validation: ${validationTime}ms, Parallel Operations: ${parallelOperationsTime}ms, ` +
          `Optimization: ${optimizationTime}ms, PDF: ${pdfGenerationTime}ms, ATS: ${atsEvaluationTime}ms)`,
      );

      // Build comprehensive result
      return {
        // Primary outputs
        pdfContent: pdfResult.pdfContent,
        filename: pdfResult.filename,

        // ATS evaluation results
        atsScore: atsEvaluation.overallScore,
        atsConfidence: atsEvaluation.confidence,
        atsMatchHistoryId: atsMatchHistoryId || 'unknown',

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
          atsEvaluationTimeMs: atsEvaluationTime,
          totalProcessingTimeMs: totalProcessingTime,
        },
        contentSource: resumeContent.source,

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
        `V2 resume generation failed after ${processingTime}ms`,
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

      // Handle ATS evaluation failures - should not block resume generation
      if (error instanceof Error && error.message.includes('ATS evaluation')) {
        this.logger.warn(
          'ATS evaluation failed, but resume generation could continue',
          error,
        );
        // For now, we'll treat it as a general error, but in future iterations
        // we could potentially return the PDF without ATS score
      }

      // Handle any unexpected errors
      throw new InternalServerErrorException(
        'Resume generation failed due to an internal error. Please try again or contact support if the issue persists.',
        ERROR_CODES.INTERNAL_SERVER,
      );
    }
  }

  /**
   * Converts optimized TailoredContent structure to plain text for ATS evaluation
   * @param content - Structured resume content
   * @returns Plain text representation of the resume
   */
  private convertOptimizedContentToText(content: TailoredContent): string {
    try {
      const sections: string[] = [];

      // Add contact info
      if (content.contactInfo) {
        const contact = content.contactInfo;
        sections.push(`${contact.name || ''}`);
        if (contact.email) sections.push(`Email: ${contact.email}`);
        if (contact.phone) sections.push(`Phone: ${contact.phone}`);
        if (contact.location) sections.push(`Location: ${contact.location}`);
        if (contact.linkedin) sections.push(`LinkedIn: ${contact.linkedin}`);
        if (contact.github) sections.push(`GitHub: ${contact.github}`);
      }

      // Add professional summary
      if (content.summary) {
        sections.push(`\nPROFESSIONAL SUMMARY\n${content.summary}`);
      }

      // Add skills
      if (content.skills) {
        const skills = content.skills;
        const skillSections: string[] = [];

        if (skills.languages?.length) {
          skillSections.push(`Languages: ${skills.languages.join(', ')}`);
        }
        if (skills.frameworks?.length) {
          skillSections.push(`Frameworks: ${skills.frameworks.join(', ')}`);
        }
        if (skills.tools?.length) {
          skillSections.push(`Tools: ${skills.tools.join(', ')}`);
        }
        if (skills.databases?.length) {
          skillSections.push(`Databases: ${skills.databases.join(', ')}`);
        }
        if (skills.concepts?.length) {
          skillSections.push(`Concepts: ${skills.concepts.join(', ')}`);
        }

        if (skillSections.length > 0) {
          sections.push(`\nSKILLS\n${skillSections.join('\n')}`);
        }
      }

      // Add experience
      if (content.experience?.length) {
        sections.push('\nPROFESSIONAL EXPERIENCE');
        for (const exp of content.experience) {
          const expSection = [
            `${exp.position || ''} at ${exp.company || ''}`,
            `${exp.duration || ''} | ${exp.location || ''}`,
          ];

          if (exp.responsibilities?.length) {
            expSection.push('Responsibilities:');
            expSection.push(
              ...exp.responsibilities.map((r: string) => `• ${r}`),
            );
          }

          if (exp.achievements?.length) {
            expSection.push('Achievements:');
            expSection.push(...exp.achievements.map((a: string) => `• ${a}`));
          }

          sections.push(expSection.join('\n'));
        }
      }

      // Add education
      if (content.education?.length) {
        sections.push('\nEDUCATION');
        for (const edu of content.education) {
          sections.push(
            `${edu.degree || ''} in ${edu.major || ''}\n${edu.institution || ''}\n${edu.startDate || ''} - ${edu.endDate || ''}`,
          );
        }
      }

      // Add certifications
      if (content.certifications?.length) {
        sections.push('\nCERTIFICATIONS');
        for (const cert of content.certifications) {
          sections.push(
            `${cert.name || ''} - ${cert.issuer || ''} (${cert.date || ''})`,
          );
        }
      }

      // Add additional sections
      if (content.additionalSections?.length) {
        for (const additionalSection of content.additionalSections) {
          sections.push(
            `\n${additionalSection.title?.toUpperCase() || 'ADDITIONAL'}\n${
              additionalSection.items?.join('\n• ') || ''
            }`,
          );
        }
      }

      return sections.join('\n\n');
    } catch (error) {
      this.logger.error('Failed to convert optimized content to text', error);
      // Fallback to JSON string representation
      return JSON.stringify(content, null, 2);
    }
  }
}
