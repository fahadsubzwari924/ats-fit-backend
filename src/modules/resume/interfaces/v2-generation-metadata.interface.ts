/**
 * AI models used throughout the V2 resume generation pipeline
 */
export interface V2AIModelsUsed {
  jobAnalysis: string; // e.g., 'gpt-4-turbo'
  contentGeneration: string; // e.g., 'claude-3-5-sonnet'
  atsScoring: string; // e.g., 'claude-3-5-sonnet'
}

/**
 * V2-specific optimization metrics (simplified version)
 */
export interface V2OptimizationMetrics {
  keywordsAdded: number;
  sectionsOptimized: number;
  achievementsQuantified: number;
}

/**
 * Comprehensive metadata about the V2 resume generation process
 */
export interface V2GenerationMetadata {
  aiModelsUsed: V2AIModelsUsed;
  optimizations: V2OptimizationMetrics;
}
