export class AtsScoreResponseDto {
  score: number;
  details: {
    keywordScore: number;
    contactInfoScore: number;
    structureScore: number;
    matched: {
      hardSkills: string[];
      softSkills: string[];
      qualifications: string[];
    };
    extracted: any;
    sectionScores: Record<string, number>;
    skillMatchScore: number;
    missingKeywords: string[];
    tailoredContent: any; // LLM feedback and tailored content
    atsEvaluation: any; // advanced LLM-based ATS feedback
  };
  analysis?: any;
}
