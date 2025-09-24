/**
 * Job analysis result from GPT-4 Turbo processing
 *
 * Contains comprehensive analysis of job description including
 * extracted keywords, requirements, and categorized information.
 */
export interface JobAnalysisResult {
  // Position information
  position: {
    title: string;
    level: string;
    department: string;
    workType: string;
    location?: string;
  };

  // Technical requirements
  technical: {
    mandatorySkills: string[];
    preferredSkills: string[];
    programmingLanguages: string[];
    frameworks: string[];
    tools: string[];
    databases?: string[];
    cloudPlatforms?: string[];
    certifications?: string[];
  };

  // Experience requirements
  experience: {
    minimumYears: number;
    maximumYears?: number;
    industries?: string[];
    roleTypes?: string[];
    teamLeadership?: boolean;
    projectManagement?: boolean;
  };

  // Company and role context
  context: {
    companySize?: string;
    industry?: string;
    companyStage?: string;
    workEnvironment?: string;
    teamStructure?: string;
    keyResponsibilities: string[];
    successMetrics: string[];
    challenges?: string[];
    growthOpportunities?: string[];
  };

  // Extracted keywords for ATS optimization
  keywords: {
    primary: string[];
    secondary: string[];
    industrySpecific: string[];
    roleSpecific: string[];
    technicalTerms: string[];
    softSkills: string[];
  };

  // Analysis metadata
  analysisMetadata: {
    confidence: number;
    processingTime: number;
    aiModel: string;
    extractedSections: string[];
    analysisQuality: 'high' | 'medium' | 'low';
  };

  // Additional metadata for backward compatibility
  metadata: {
    complexity: 'low' | 'medium' | 'high';
    competitiveness: 'low' | 'medium' | 'high';
    processedAt: Date;
    confidenceScore: number;
  };
}
