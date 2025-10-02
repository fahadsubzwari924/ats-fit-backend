/**
 * ATS Analysis type definitions
 */
export interface AtsAnalysisMatched {
  hardSkills?: string[];
  softSkills?: string[];
  qualifications?: string[];
}

export interface AtsAnalysisSectionScores {
  contactInfo?: number;
  structure?: number;
  [key: string]: number | undefined;
}

export interface AtsAnalysisDetails {
  keywordScore?: number;
  contactInfoScore?: number;
  structureScore?: number;
  matched?: AtsAnalysisMatched;
  extracted?: any;
  sectionScores?: AtsAnalysisSectionScores;
  skillMatchScore?: number;
  missingKeywords?: string[];
  tailoredContent?: any;
  atsEvaluation?: any;
}

export interface AtsAnalysis {
  score?: number;
  atsMatchHistoryId?: string;
  details?: AtsAnalysisDetails;
  analysis?: any;
  // Legacy fields for backward compatibility
  matched?: AtsAnalysisMatched;
  missingKeywords?: string[];
  skillMatchScore?: number;
  sectionScores?: AtsAnalysisSectionScores;
}
