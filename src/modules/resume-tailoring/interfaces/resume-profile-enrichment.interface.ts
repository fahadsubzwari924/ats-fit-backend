/**
 * Resume Profile Enrichment Interfaces
 *
 * Defines types for profile-level Q&A and enriched resume profile status
 * used by GET /users/resume-profile-status and profile-questions endpoints.
 */

export type TailoringMode = 'none' | 'standard' | 'enhanced' | 'precision';

export type ProcessingStatus =
  | 'none'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export interface ResumeProfileStatusResponse {
  hasResume: boolean;
  processingStatus: ProcessingStatus;
  questionsTotal: number;
  questionsAnswered: number;
  profileCompleteness: number;
  enrichedProfileId: string | null;
  tailoringMode: TailoringMode;
}

export interface ProfileQuestionStatus {
  id: string;
  workExperienceIndex: number;
  bulletPointIndex: number;
  originalBulletPoint: string;
  questionText: string;
  questionCategory: string;
  userResponse: string | null;
  isAnswered: boolean;
  orderIndex: number;
  companyName: string | null;
  jobTitle: string | null;
}

export interface AnswerProfileQuestionPayload {
  questionId: string;
  response: string | null;
}
