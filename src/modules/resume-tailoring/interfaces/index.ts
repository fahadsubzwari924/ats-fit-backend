// Resume Generation Interfaces
export * from './resume-generation.interface';
export {
  AIModelsUsed,
  GenerationMetadata,
  OptimizationMetrics as GenerationOptimizationMetrics,
} from './generation-metadata.interface';
export * from './user-context.interface';
export * from './job-analysis.interface';
export * from './resume-optimization.interface';
export * from './pdf-generation.interface';
export * from './pdf-service.interface';

// Legacy interfaces
export * from './resume-extracted-keywords.interface';
export * from './resume-template.interface';
