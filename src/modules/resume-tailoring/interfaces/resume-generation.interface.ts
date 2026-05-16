import type { UserContext } from './user-context.interface';
import type { MatchScoreBlock } from './match-score-block.interface';
import type { JobRelevanceResult } from '../../job-relevance/interfaces/job-relevance.interface';

/**
 * Input parameters for resume generation orchestration
 *
 * This interface defines all required and optional parameters
 * for the enhanced resume generation pipeline.
 */
export interface ResumeGenerationInput {
  jobDescription: string;
  jobPosition: string;
  companyName: string;
  templateId: string;
  resumeId?: string;
  userContext: UserContext;
  resumeFile?: Express.Multer.File;
  acknowledgeLowFit?: boolean;
}

/**
 * Detailed processing metrics for each step of generation
 *
 * Provides comprehensive timing information for performance
 * monitoring and optimization analysis.
 */
export interface ProcessingMetrics {
  validationTimeMs: number;
  parallelOperationsTimeMs: number; // Combined job analysis + content processing time
  optimizationTimeMs: number;
  pdfGenerationTimeMs: number;
  dbSaveTimeMs: number;
  totalProcessingTimeMs: number;
}

/**
 * Comprehensive result from resume generation pipeline
 *
 * Contains all outputs, metrics, and metadata from the complete
 * AI-powered resume generation and optimization process.
 *
 * Discriminated union on `kind`:
 *   - `'pdf'`             — generation succeeded; all PDF result fields present.
 *   - `'low_fit_warning'` — job relevance score is below threshold and the
 *                           user has not acknowledged; no PDF was produced.
 */
export type ResumeGenerationResult =
  | ({
      kind: 'pdf';
      relevance?: JobRelevanceResult;
    } & {
      // Primary outputs
      pdfContent: string; // base64 encoded PDF
      filename: string;

      // Generation tracking
      resumeGenerationId: string;

      // Optimization metrics
      keywordsAdded: number;
      sectionsChanged: number;
      sectionsOptimized: number;
      achievementsQuantified: number;
      optimizationConfidence: number;

      // Processing metadata
      processingMetrics: ProcessingMetrics;
      contentSource:
        | 'file_upload'
        | 'database_extraction'
        | 'database_existing';
      /** v4: quality mode (standard | enhanced | precision) for badge display */
      tailoringMode?: 'none' | 'standard' | 'enhanced' | 'precision';

      // PDF metadata
      pdfSizeBytes: number;
      templateUsed: string;

      // Job analysis insights
      primaryKeywordsFound: number;
      mandatorySkillsAligned: number;

      /**
       * Canonical match-score block — the single source of truth FE renders from.
       * Replaces the flat `matchScoreBefore`/`matchScoreAfter`/`matchScoreDelta`
       * fields below, which are kept populated for one transition cycle.
       */
      matchScore: MatchScoreBlock;
      /** @deprecated use `matchScore.before`; removed after FE migration lands */
      matchScoreBefore: number;
      /** @deprecated use `matchScore.after`; removed after FE migration lands */
      matchScoreAfter: number;
      /** @deprecated use `matchScore.delta`; removed after FE migration lands */
      matchScoreDelta: number;

      // ATS compliance checks (synchronous)
      atsChecksPassed: number;
      atsChecksTotal: number;

      // Quantified bullets (synchronous)
      bulletsQuantifiedBefore: number;
      bulletsQuantifiedAfter: number;
      bulletsQuantifiedTotal: number;
    })
  | {
      kind: 'low_fit_warning';
      relevance: JobRelevanceResult;
    };
