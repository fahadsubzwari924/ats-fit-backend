/**
 * Input contract for `JobApplicationService.trackTailoringApplication`.
 *
 * Both the single-tailoring orchestrator and the batch processor have these
 * fields already in scope when a resume generation completes successfully,
 * so the service does not re-read the resume_generations row.
 */
export interface ITrackTailoringApplication {
  userId: string;
  resumeGenerationId: string;
  companyName: string;
  jobPosition: string;
  jobDescription: string;
}
