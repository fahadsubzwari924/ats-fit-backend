/**
 * AI models used throughout the resume generation pipeline
 */
export interface AIModelsUsed {
  jobAnalysis: string; // e.g., 'gpt-4-turbo'
  contentGeneration: string; // e.g., 'claude-3-5-sonnet'
  atsScoring: string; // e.g., 'claude-3-5-sonnet'
}

/**
 * Optimization metrics from resume generation process
 */
export interface OptimizationMetrics {
  keywordsAdded: number;
  sectionsOptimized: number;
  achievementsQuantified: number;
}

/**
 * Comprehensive metadata about the resume generation process
 */
export interface GenerationMetadata {
  aiModelsUsed: AIModelsUsed;
  optimizations: OptimizationMetrics;
}
