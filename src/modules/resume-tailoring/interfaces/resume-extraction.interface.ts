/**
 * Resume Extraction Interfaces
 *
 * Data structures for resume content extraction (e.g. queue job payloads).
 */

/**
 * Job data for the resume extraction queue processor
 */
export interface ResumeExtractionJobData {
  queueMessageId: string;
  userId: string;
  fileName: string;
  s3Url: string;
  fileSize: number;
  resumeId: string;
}

/**
 * Job data for the profile enrichment queue processor
 */
export interface ProfileEnrichmentJobData {
  queueMessageId: string;
  userId: string;
}

/**
 * Job data for the changes diff computation queue processor.
 * Carries the original and optimized resume content so the processor
 * can compute diffs without hitting the database for content.
 */
export interface ChangesDiffJobData {
  queueMessageId: string;
  resumeGenerationId: string;
  userId: string;
  originalContent: Record<string, unknown>;
  optimizedContent: Record<string, unknown>;
  jobAnalysisKeywords: {
    mandatorySkills: string[];
    primaryKeywords: string[];
  };
}
