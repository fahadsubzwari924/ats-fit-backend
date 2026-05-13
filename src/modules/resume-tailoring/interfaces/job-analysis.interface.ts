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
    /**
     * Canonical per-keyword alias set emitted by the JD-analysis LLM.
     * Consumed by `KeywordMatchScoringService` to expand the searchable
     * surface beyond literal keyword strings. New canonical field.
     */
    aliases?: Array<{ term: string; alternatives: string[] }>;
    /**
     * Legacy mirror of `aliases` retained for one prompt-version cycle so
     * pre-existing `job_analysis` JSONB rows (which persisted under
     * `synonyms` in either canonical array or legacy map shape) still
     * deserialize. Reads route through the orchestrator's `readJdAliases`
     * helper, which tolerates both shapes.
     */
    synonyms?:
      | Array<{ term: string; alternatives: string[] }>
      | Record<string, string[]>;
  };

  metadata: {
    complexity: 'low' | 'medium' | 'high';
    competitiveness: 'low' | 'medium' | 'high';
    confidenceScore: number;
    processedAt: Date;
  };
}
