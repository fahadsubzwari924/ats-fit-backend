import { UserType } from '../../../database/entities/user.entity';

/**
 * User context for resume processing operations
 *
 * - `userType` is the persistence-layer enum value (`'registered'`). DB columns
 *   of type `user_type_enum` only accept this value.
 * - `plan` is the domain plan tier (`'freemium' | 'premium'`). All plan-tier
 *   branching MUST use this field, never `userType`.
 */
export interface UserContext {
  userId?: string;
  userType: UserType;
  plan: 'freemium' | 'premium';
  isPremium?: boolean;
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
