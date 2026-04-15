/**
 * User context for resume processing operations
 *
 * Defines user identification information used throughout
 * the resume generation pipeline for both authenticated
 * and guest users.
 */
export interface UserContext {
  userId?: string;
  userType: 'freemium' | 'premium';
}

/**
 * Content processing source types
 *
 * Indicates where the resume content originated from
 * during the processing pipeline.
 */
export type ContentSource =
  | 'file_upload'
  | 'database_extraction'
  | 'database_existing';

/**
 * Tailoring mode for resume quality badge (v4 profile enrichment).
 */
export type TailoringModeResult =
  | 'none'
  | 'standard'
  | 'enhanced'
  | 'precision';

/**
 * User-verified fact from profile Q&A (source of truth for optimization prompts).
 */
export interface VerifiedFact {
  originalBulletPoint: string;
  userResponse: string;
}

/**
 * Resume content processing result
 *
 * Contains the processed resume content along with
 * metadata about the processing source and method.
 */
export interface ResumeContentResult {
  content: any; // TailoredContent - keeping as any for now due to existing dependencies
  /**
   * Raw extracted resume content — never enriched or optimized.
   * Always reflects what the user originally submitted.
   * Used as the diff "before" baseline.
   */
  rawContent: any;
  source: ContentSource;
  originalText: string;
  /** v4: quality mode when using enriched profile */
  tailoringMode?: TailoringModeResult;
  /** Answered profile questions with non-empty userResponse (for precision optimization) */
  verifiedFacts?: VerifiedFact[];
  metadata: {
    extractionMethod: string;
    processingTime?: number;
    confidenceScore?: number;
    extractedSections?: string[];
    fileSize?: number;
    resumeId?: string;
  };
}
