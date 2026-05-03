/**
 * Job analysis result from GPT-4 Turbo processing
 *
 * Contains comprehensive analysis of job description including
 * extracted keywords, requirements, and categorized information.
 * Shape matches JobAnalysisJsonSchema exactly.
 */
export interface JobAnalysisResult {
  position: {
    title: string;
    level: 'junior' | 'mid' | 'senior' | 'lead' | 'principal' | 'director';
    department: string;
    workType: 'remote' | 'hybrid' | 'onsite' | 'flexible';
  };

  technical: {
    mandatorySkills: string[];
    preferredSkills: string[];
    programmingLanguages: string[];
    frameworks: string[];
    tools: string[];
    databases: string[];
    cloudPlatforms: string[];
    methodologies: string[];
  };

  experience: {
    minimumYears: number;
    maximumYears: number;
    industryPreferences: string[];
    domainExperience: string[];
  };

  qualifications: {
    education: {
      required: string[];
      preferred: string[];
    };
    certifications: string[];
    softSkills: string[];
    leadership: string[];
  };

  context: {
    companyStage: string;
    teamSize: string;
    reportingStructure: string;
    keyResponsibilities: string[];
    successMetrics: string[];
  };

  keywords: {
    primary: string[];
    secondary: string[];
    synonyms: Array<{ term: string; alternatives: string[] }>;
  };

  metadata: {
    complexity: 'low' | 'medium' | 'high';
    competitiveness: 'low' | 'medium' | 'high';
    confidenceScore: number;
    processedAt: Date;
  };
}
