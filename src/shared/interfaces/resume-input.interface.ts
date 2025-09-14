/**
 * Abstraction for resume input data regardless of source
 */
export interface ResumeInputData {
  /**
   * Raw text extracted from resume
   */
  text: string;

  /**
   * Source of the resume data
   */
  source: 'file' | 'database';

  /**
   * Original filename for tracking purposes
   */
  originalFileName?: string;

  /**
   * Resume ID if from database
   */
  resumeId?: string;
}

/**
 * User context for ATS operations
 */
export interface AtsUserContext {
  userId?: string;
  guestId?: string;
  userType: string;
  plan?: string;
  isPremium?: boolean;
}

/**
 * Additional data for ATS evaluation
 */
export interface AtsEvaluationOptions {
  companyName?: string;
  resumeContent?: string;
}
