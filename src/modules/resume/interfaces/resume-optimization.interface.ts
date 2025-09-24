import type { TailoredContent } from './resume-extracted-keywords.interface';

/**
 * Resume optimization metrics from AI processing
 *
 * Quantifies the improvements made during the optimization process.
 */
export interface OptimizationMetrics {
  keywordsAdded: number;
  sectionsOptimized: number;
  achievementsQuantified: number;
  skillsAligned: number;
  confidenceScore: number; // 0-100 based on optimization quality
}

/**
 * Optimization strategy details
 *
 * Describes the approach and changes made during optimization.
 */
export interface OptimizationStrategy {
  primaryFocus: string[]; // Main optimization areas
  improvementAreas: string[]; // Key improvements made
  atsOptimizations: string[]; // ATS-specific changes
  recommendations: string[]; // Additional recommendations
}

/**
 * AI processing metadata
 *
 * Technical details about the AI model and processing.
 */
export interface AIProcessingMetadata {
  aiModel: string;
  processingTimeMs: number;
  tokensUsed?: number;
}

/**
 * Complete resume optimization result from Claude 3.5 Sonnet
 *
 * Contains optimized content along with detailed metrics and strategy information.
 */
export interface ResumeOptimizationResult {
  optimizedContent: TailoredContent;
  optimizationMetrics: OptimizationMetrics;
  optimizationStrategy: OptimizationStrategy;
  processingMetadata: AIProcessingMetadata;
}
