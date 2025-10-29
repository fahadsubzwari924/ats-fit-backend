/**
 * Resume Generation Job Interfaces
 *
 * Defines the data structures for async resume generation queue jobs.
 * Following interface segregation principle for clean separation.
 */

/**
 * Resume generation job status
 * Tracks the lifecycle of a resume generation job
 */
export enum ResumeGenerationJobStatus {
  QUEUED = 'queued',
  VALIDATING = 'validating',
  ANALYZING_JOB = 'analyzing_job',
  PROCESSING_RESUME = 'processing_resume',
  OPTIMIZING_CONTENT = 'optimizing_content',
  GENERATING_PDF = 'generating_pdf',
  EVALUATING_ATS = 'evaluating_ats',
  SAVING_RESULTS = 'saving_results',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
}

/**
 * Progress percentage mapping for each status
 */
export const RESUME_GENERATION_PROGRESS: Record<
  ResumeGenerationJobStatus,
  number
> = {
  [ResumeGenerationJobStatus.QUEUED]: 0,
  [ResumeGenerationJobStatus.VALIDATING]: 5,
  [ResumeGenerationJobStatus.ANALYZING_JOB]: 15,
  [ResumeGenerationJobStatus.PROCESSING_RESUME]: 30,
  [ResumeGenerationJobStatus.OPTIMIZING_CONTENT]: 50,
  [ResumeGenerationJobStatus.GENERATING_PDF]: 70,
  [ResumeGenerationJobStatus.EVALUATING_ATS]: 85,
  [ResumeGenerationJobStatus.SAVING_RESULTS]: 95,
  [ResumeGenerationJobStatus.COMPLETED]: 100,
  [ResumeGenerationJobStatus.FAILED]: 0,
  [ResumeGenerationJobStatus.RETRYING]: 0,
};

/**
 * Resume file data for queue processing
 */
export interface ResumeFileData {
  originalname: string;
  buffer: string; // base64 encoded
  size: number;
  mimetype: string;
}

/**
 * Data structure for resume generation queue job
 */
export interface ResumeGenerationJobData {
  queueMessageId: string;
  userId?: string;
  guestId?: string;
  jobDescription: string;
  jobPosition: string;
  companyName: string;
  templateId: string;
  resumeId?: string;
  resumeFile?: ResumeFileData;
}

/**
 * Progress update data emitted during processing
 */
export interface ResumeGenerationProgressUpdate {
  jobId: string;
  status: ResumeGenerationJobStatus;
  progress: number;
  currentStep: string;
  estimatedTimeRemaining?: number; // in seconds
  metadata?: Record<string, any>;
}

/**
 * Job status response for API endpoints
 */
export interface ResumeGenerationJobStatusResponse {
  jobId: string;
  status: ResumeGenerationJobStatus;
  progress: number;
  currentStep: string;
  result?: ResumeGenerationJobResult;
  error?: string;
  processingMetrics?: ProcessingMetrics;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedTimeRemaining?: number;
}

/**
 * Job result data when completed
 */
export interface ResumeGenerationJobResult {
  resumeGenerationId: string;
  atsScore: number;
  atsConfidence: number;
  filename: string;
  fileSize: number;
  downloadUrl?: string;
  keywordsAdded: number;
  sectionsOptimized: number;
  optimizationConfidence: number;
}

/**
 * Processing metrics for performance tracking
 */
export interface ProcessingMetrics {
  validationTimeMs: number;
  jobAnalysisTimeMs: number;
  resumeProcessingTimeMs: number;
  optimizationTimeMs: number;
  pdfGenerationTimeMs: number;
  atsEvaluationTimeMs: number;
  savingTimeMs: number;
  totalProcessingTimeMs: number;
}

/**
 * Job creation response
 */
export interface CreateResumeGenerationJobResponse {
  jobId: string;
  status: ResumeGenerationJobStatus;
  message: string;
  estimatedCompletionTime: number; // in seconds
  pollingInterval: number; // recommended polling interval in ms
}
