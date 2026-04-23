export interface BulletContext {
  workExperienceIndex: number;
  bulletPointIndex: number;
  originalBulletPoint: string;
  positionTitle?: string;
  /** Composite relevance × unquantified × visibility score — higher = better question candidate */
  questionValue: number;
}
