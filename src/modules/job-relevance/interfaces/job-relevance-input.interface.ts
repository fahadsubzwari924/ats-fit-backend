import type { TailoredContent } from '../../resume-tailoring/interfaces/resume-extracted-keywords.interface';

export type JobRelevanceProfileSource =
  | { kind: 'enriched'; profileVersion: number; content: TailoredContent }
  | { kind: 'extracted'; content: TailoredContent }
  | { kind: 'raw-text'; text: string }
  | { kind: 'none' };

export interface JobRelevanceInput {
  userId: string | null;
  profile: JobRelevanceProfileSource;
  jobPosition: string;
  companyName: string;
  jobDescription: string;
  abortSignal?: AbortSignal;
}
