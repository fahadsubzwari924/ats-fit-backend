// ats-evaluation.interface.ts
export interface PremiumAtsEvaluation {
  overallScore: number;
  technicalSkillsScore: number;
  experienceAlignmentScore: number;
  achievementsScore: number;
  softSkillsScore: number;
  resumeQualityScore: number;
  detailedBreakdown: {
    technicalSkills: {
      matched: string[];
      missing: string[];
      score: number;
      reasoning: string;
    };
    experience: {
      level: string;
      years: number;
      relevance: number;
      reasoning: string;
    };
    achievements: {
      count: number;
      quality: number;
      impact: number;
      reasoning: string;
    };
    softSkills: {
      matched: string[];
      missing: string[];
      score: number;
      reasoning: string;
    };
    redFlags: string[];
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
  };
  confidence: number;
}

export interface StandardAtsEvaluation {
  requiredSectionsPresent: boolean;
  contactInfo: {
    emailPresent: boolean;
    phonePresent: boolean;
    linkedinPresent: boolean;
    emailValid: boolean;
    phoneValid: boolean;
  };
  chronology: {
    gaps: Array<{ start: string; end: string }>;
    overlaps: Array<{ start: string; end: string }>;
    isReverseChronological: boolean;
  };
  seniorityMatch: string;
  quantifiableAchievements: {
    count: number;
    examples: string[];
  };
  softSkills: string[];
  softSkillsMatch: string[];
  redFlags: string[];
  feedback: string;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  technicalSkillsMatch?: {
    matchedSkills: string[];
    missingSkills: string[];
    relatedSkills: string[];
  };
}

export interface AtsScoreBreakdown {
  technicalSkills: number;
  experienceAlignment: number;
  achievements: number;
  softSkills: number;
  resumeQuality: number;
  overallScore: number;
  confidence: number;
} 