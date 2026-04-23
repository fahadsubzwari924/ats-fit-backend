export interface ScoredBullet {
  experienceIndex: number;
  bulletIndex: number;
  bulletText: string;
  /** 0–1: overlap between bullet tokens and JD keyword set */
  relevanceScore: number;
  /** 0–1: how well-quantified the bullet already is */
  quantificationScore: number;
  /** 0–1: positional weight — higher for bullets in more recent jobs */
  visibilityScore: number;
  /** Composite priority for question generation: high when relevant but unquantified */
  questionValue: number;
}
