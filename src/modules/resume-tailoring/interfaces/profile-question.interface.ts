export type QuestionCategory =
  | 'metrics'
  | 'impact'
  | 'scope'
  | 'technology'
  | 'outcome';

/** Only the creative output from the LLM — indices are intentionally excluded. */
export interface AIQuestionFromLLM {
  questionText: string;
  questionCategory: QuestionCategory;
}

/** Final question with authoritative indices from BulletContext + LLM-generated text. */
export interface ResolvedProfileQuestion {
  workExperienceIndex: number;
  bulletPointIndex: number;
  originalBulletPoint: string;
  questionText: string;
  questionCategory: QuestionCategory;
}
