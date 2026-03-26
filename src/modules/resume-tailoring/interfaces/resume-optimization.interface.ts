import type { TailoredContent } from './resume-extracted-keywords.interface';

/**
 * Raw AI-generated resume response structure (e.g. from Claude/OpenAI).
 * Used for parsing and validation before mapping to ResumeOptimizationResult.
 */
export interface AIResumeResponse {
  optimizedContent: TailoredContent;
  enhancementMetrics?: {
    keywordsAdded?: number;
    sectionsOptimized?: number;
    achievementsQuantified?: number;
    skillsAligned?: number;
    confidenceScore?: number;
  };
  enhancementSummary?: {
    factsUsed?: string[];
    improvementAreas?: string[];
    atsOptimizations?: string[];
    recommendations?: string[];
  };
}

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
 * A single section-level change produced by the AI optimizer.
 */
export interface SectionDiff {
  section: string;
  changeType: 'modified' | 'added' | 'removed' | 'unchanged';
  original: string;
  optimized: string;
  addedKeywords: string[];
}

/**
 * Structured diff returned by the AI alongside the optimized resume.
 */
export interface ResumeDiff {
  totalChanges: number;
  sectionsChanged: number;
  changes: SectionDiff[];
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
  changesDiff?: ResumeDiff;
}
