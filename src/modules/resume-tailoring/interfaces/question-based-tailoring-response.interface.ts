/**
 * Question-Based Tailoring Response Interfaces
 *
 * Defines the structure of responses for the 2-step question-based
 * resume tailoring process that eliminates AI hallucination.
 */

/**
 * Internal AI-generated question with rationale (used during generation)
 */
export interface AIGeneratedQuestion {
  workExperienceIndex: number;
  workExperienceTitle: string;
  bulletPointIndex: number;
  originalBulletPoint: string;
  questionText: string;
  questionCategory: string;
  rationale: string;
}

/**
 * Internal response structure from AI question generation
 */
export interface AIQuestionGenerationResponse {
  questions: AIGeneratedQuestion[];
  analysis: TailoringAnalysis;
  recommendations: string[];
}

/**
 * Represents a single generated question for a resume bullet point
 */
export interface TailoringQuestion {
  id: string;
  workExperienceTitle: string;
  workExperienceIndex: number;
  bulletPointIndex: number;
  originalBulletPoint: string;
  questionText: string;
  questionCategory: string;
}

/**
 * Analysis results from job description and resume comparison
 */
export interface TailoringAnalysis {
  totalWorkExperiences: number;
  totalBulletPoints: number;
  questionsGenerated: number;
  strengthAreas: string[];
  improvementAreas: string[];
  jobAlignmentScore: number;
}

/**
 * Complete response from initiating question-based tailoring
 *
 * Contains the session ID, generated questions, analysis results,
 * and recommendations for the user.
 */
export interface QuestionBasedTailoringInitiationResponse {
  sessionId: string;
  questions: TailoringQuestion[];
  analysis: TailoringAnalysis;
  recommendations: string[];
}

/**
 * Represents a single question with user's answer
 */
export interface SessionQuestion {
  id: string;
  workExperienceTitle: string;
  originalBulletPoint: string;
  questionText: string;
  questionCategory: string;
  isAnswered: boolean;
  userResponse?: string;
}

/**
 * Session details response structure
 */
export interface TailoringSessionDetails {
  session: {
    id: string;
    status: string;
    jobPosition: string;
    companyName: string;
    createdAt: Date;
  };
  questions: SessionQuestion[];
}

/**
 * Response after submitting question answers
 */
export interface QuestionResponsesSubmissionResult {
  sessionId: string;
  status: string;
  questionsAnswered: number;
  message: string;
}

/**
 * Metrics about the resume enhancement process
 */
export interface ResumeEnhancementMetrics {
  bulletPointsEnhanced: number;
  metricsAdded: number;
  keywordsIntegrated: number;
  userResponsesUsed: number;
  confidenceScore: number;
}

/**
 * Complete response from fact-based resume generation
 */
export interface FactBasedResumeGenerationResponse {
  sessionId: string;
  resumeContent: any;
  enhancementMetrics: ResumeEnhancementMetrics;
  message: string;
}
