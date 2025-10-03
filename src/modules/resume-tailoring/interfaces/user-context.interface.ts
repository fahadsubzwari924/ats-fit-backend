/**
 * User context for resume processing operations
 *
 * Defines user identification information used throughout
 * the resume generation pipeline for both authenticated
 * and guest users.
 */
export interface UserContext {
  userId?: string;
  guestId?: string;
  userType: 'guest' | 'freemium' | 'premium';
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
 * Resume content processing result
 *
 * Contains the processed resume content along with
 * metadata about the processing source and method.
 */
export interface ResumeContentResult {
  content: any; // TailoredContent - keeping as any for now due to existing dependencies
  source: ContentSource;
  originalText: string;
  metadata: {
    extractionMethod: string;
    processingTime?: number;
    confidenceScore?: number;
    extractedSections?: string[];
    fileSize?: number;
    resumeId?: string;
  };
}
