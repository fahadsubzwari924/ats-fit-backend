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
  fileBuffer: Buffer;
  fileSize: number;
  resumeId: string;
}
