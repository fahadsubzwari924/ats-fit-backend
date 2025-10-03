// TailoredContent type commented out due to type complexity
// import { TailoredContent } from '../../resume-tailoring/interfaces/resume-extracted-keywords.interface';

/**
 * Input interface for ATS score calculation
 * Abstracts whether resume comes from file or pre-processed content
 */
export interface AtsScoreInput {
  /**
   * Raw text extracted from resume
   */
  resumeText: string;

  /**
   * Optional structured content from resume (if available from pre-processing)
   */
  structuredContent?: any;

  /**
   * Source of the resume data
   */
  source: 'file' | 'preprocessed';

  /**
   * ID of the resume if from preprocessed source
   */
  resumeId?: string;

  /**
   * Original filename for tracking
   */
  originalFileName?: string;
}

/**
 * Context interface for user information
 */
export interface UserContextForAts {
  userId?: string;
  guestId?: string;
  userType: string;
  plan?: string;
  isPremium?: boolean;
}

/**
 * Additional data for ATS evaluation
 */
export interface AtsAdditionalData {
  companyName?: string;
  resumeContent?: string;
}
