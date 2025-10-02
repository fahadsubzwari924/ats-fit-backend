import type { UserContext } from './user-context.interface';

/**
 * Input parameters for V2 resume generation orchestration
 *
 * This interface defines all required and optional parameters
 * for the enhanced V2 resume generation pipeline.
 */
export interface ResumeGenerationV2Input {
  jobDescription: string;
  jobPosition: string;
  companyName: string;
  templateId: string;
  resumeId?: string;
  userContext: UserContext;
  resumeFile?: Express.Multer.File;
}

/**
 * Detailed processing metrics for each step of V2 generation
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
  atsEvaluationTimeMs: number;
  totalProcessingTimeMs: number;
}

/**
 * Comprehensive result from V2 resume generation pipeline
 *
 * Contains all outputs, metrics, and metadata from the complete
 * AI-powered resume generation and optimization process.
 */
export interface ResumeGenerationV2Result {
  // Primary outputs
  pdfContent: string; // base64 encoded PDF
  filename: string;

  // Generation tracking
  resumeGenerationId: string;

  // ATS evaluation results
  atsScore: number;
  atsConfidence: number;
  atsMatchHistoryId: string;

  // Optimization metrics
  keywordsAdded: number;
  sectionsOptimized: number;
  achievementsQuantified: number;
  optimizationConfidence: number;

  // Processing metadata
  processingMetrics: ProcessingMetrics;
  contentSource: 'file_upload' | 'database_extraction' | 'database_existing';

  // PDF metadata
  pdfSizeBytes: number;
  templateUsed: string;

  // Job analysis insights
  primaryKeywordsFound: number;
  mandatorySkillsAligned: number;
}
