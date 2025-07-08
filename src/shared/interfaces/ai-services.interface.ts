// ai-services.interface.ts
export interface SkillMatch {
  skill: string;
  found: boolean;
  confidence: number;
  variations: string[];
  context: string;
}

export interface NlpAnalysis {
  keywordMatches: SkillMatch[];
  semanticScore: number;
  skillCoverage: number;
  experienceAlignment: number;
  overallNlpScore: number;
}

export interface AiServiceConfig {
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  temperature: number;
  maxTokens: number;
}

export interface AiEvaluationResult {
  score: number;
  confidence: number;
  breakdown: Record<string, any>;
  metadata: Record<string, any>;
}

export interface AiPromptParams {
  content: string;
  context?: Record<string, any>;
  format?: 'json' | 'text';
  temperature?: number;
  maxTokens?: number;
} 