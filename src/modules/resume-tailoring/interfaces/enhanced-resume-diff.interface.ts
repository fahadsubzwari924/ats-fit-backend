/**
 * Enhanced Resume Diff Interfaces
 *
 * These types describe the programmatically-computed diff produced by
 * ChangesDiffComputationService after resume optimization completes.
 * Stored in resume_generations.changes_diff (version: 2).
 *
 * The legacy flat `changes` array is included for backward compatibility
 * with the existing frontend SectionDiff format and the history modal.
 */

export type DiffChangeType = 'modified' | 'added' | 'removed' | 'unchanged';

/** Diff for a single responsibility bullet point within a work experience. */
export interface BulletDiff {
  changeType: DiffChangeType;
  original: string;
  optimized: string;
  /** Job-analysis keywords that appear in `optimized` but not in `original`. */
  addedKeywords: string[];
  /** Jaccard token-overlap similarity score between original and optimized (0–1). */
  similarity: number;
}

/** Diff for a single skill category (languages, frameworks, tools, etc.). */
export interface SkillsCategoryDiff {
  category: string;
  original: string[];
  optimized: string[];
  added: string[];
  removed: string[];
}

/** Diff for one work experience entry including bullet-level changes. */
export interface ExperienceDiff {
  company: string;
  position: string;
  changeType: DiffChangeType;
  titleChanged: boolean;
  originalTitle: string;
  optimizedTitle: string;
  bulletChanges: BulletDiff[];
}

/** Keyword coverage before and after optimization against job analysis targets. */
export interface KeywordCoverageAnalysis {
  targetKeywords: string[];
  originalMatches: string[];
  newlyAdded: string[];
  stillMissing: string[];
  /** 0–100 percentage */
  coverageOriginal: number;
  /** 0–100 percentage */
  coverageOptimized: number;
}

/** Legacy-compatible section-level change (mirrors the old SectionDiff shape). */
export interface LegacySectionChange {
  section: string;
  changeType: DiffChangeType;
  original: string;
  optimized: string;
  addedKeywords: string[];
}

/**
 * Full enhanced diff document stored in resume_generations.changes_diff.
 * `version: 2` distinguishes it from legacy AI-generated diffs (version < 2).
 */
export interface EnhancedResumeDiff {
  version: 2;
  totalChanges: number;
  sectionsChanged: number;
  computedAt: string;

  summary: {
    changeType: DiffChangeType;
    original: string;
    optimized: string;
    addedKeywords: string[];
  } | null;

  skills: {
    changeType: DiffChangeType;
    byCategory: SkillsCategoryDiff[];
    totalAdded: number;
    totalRemoved: number;
  } | null;

  experience: ExperienceDiff[];

  keywordAnalysis: KeywordCoverageAnalysis;

  /**
   * Backward-compatible flat array consumed by the existing frontend
   * ResumeComparisonComponent and history modal.
   */
  changes: LegacySectionChange[];
}
