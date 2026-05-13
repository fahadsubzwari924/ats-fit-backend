import { Injectable, Logger } from '@nestjs/common';
import {
  BulletDiff,
  DiffChangeType,
  EnhancedResumeDiff,
  ExperienceDiff,
  KeywordCoverageAnalysis,
  LegacySectionChange,
  SkillsCategoryDiff,
} from '../interfaces/enhanced-resume-diff.interface';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import { JACCARD_SIMILARITY_THRESHOLD } from '../../../shared/constants/resume-tailoring.constants';
import { KeywordMatchScoringService } from './keyword-match-scoring.service';
import { JobAnalysisResult } from '../interfaces/job-analysis.interface';

interface JobKeywords {
  mandatorySkills: string[];
  primaryKeywords: string[];
}

/**
 * Optional scoring inputs for `computeDiff` that, when supplied, route keyword
 * coverage through `KeywordMatchScoringService` instead of the literal
 * substring scan. This unifies `coverageOriginal` / `coverageOptimized` with
 * `match_score_before` / `match_score_after` (same engine, same numbers).
 *
 * Both fields are optional so legacy queue payloads (which carry neither full
 * `jobAnalysis` nor raw `originalText`) still work — the service degrades to
 * the legacy substring scan for those calls.
 */
export interface ChangesDiffScoringInput {
  /** The user's literal uploaded resume text (no LLM transformations). */
  originalText?: string;
  /** Full JD analysis result for keyword-set + alias construction. */
  jobAnalysis?: JobAnalysisResult | null;
}

/**
 * Changes Diff Computation Service
 *
 * Programmatically computes a structured, bullet-point-level diff between
 * the original candidate resume content and the AI-optimized version.
 *
 * No AI calls are made — all logic is pure TypeScript using Jaccard token
 * overlap for bullet matching. Results are stored in
 * resume_generations.changes_diff (version: 2).
 */
@Injectable()
export class ChangesDiffComputationService {
  private readonly logger = new Logger(ChangesDiffComputationService.name);

  constructor(
    private readonly keywordMatchScoringService: KeywordMatchScoringService,
  ) {}

  /**
   * Compute the full enhanced diff between original and optimized resume content.
   *
   * When `scoringInput.jobAnalysis` is provided, keyword coverage is computed
   * via `KeywordMatchScoringService` (single-engine path) so the diff's
   * `keywordAnalysis.coverageOriginal` / `coverageOptimized` numbers equal
   * `match_score_before` / `match_score_after`. Without it the service falls
   * back to the legacy literal-substring scan — used by the queue processor
   * which doesn't carry the full JD analysis in its job payload.
   */
  computeDiff(
    original: TailoredContent,
    optimized: TailoredContent,
    jobKeywords: JobKeywords,
    scoringInput?: ChangesDiffScoringInput,
  ): EnhancedResumeDiff {
    const startTime = Date.now();

    const targetKeywords = [
      ...new Set([
        ...jobKeywords.mandatorySkills,
        ...jobKeywords.primaryKeywords,
      ]),
    ];

    const summaryDiff = this.computeSummaryDiff(
      original.summary ?? '',
      optimized.summary ?? '',
      targetKeywords,
    );

    const skillsDiff = this.computeSkillsDiff(
      original.skills,
      optimized.skills,
    );

    const experienceDiffs = this.computeExperienceDiffs(
      original.experience ?? [],
      optimized.experience ?? [],
      targetKeywords,
    );

    const keywordAnalysis = this.computeKeywordCoverage(
      original,
      optimized,
      targetKeywords,
      scoringInput,
    );

    const changes = this.buildLegacyChanges(
      summaryDiff,
      skillsDiff,
      experienceDiffs,
    );

    const sectionsChanged = this.countSectionsChanged(
      summaryDiff,
      skillsDiff,
      experienceDiffs,
    );

    const totalChanges = changes.filter(
      (c) => c.changeType !== 'unchanged',
    ).length;

    this.logger.debug(
      `Diff computed in ${Date.now() - startTime}ms: ${totalChanges} changes across ${sectionsChanged} sections`,
    );

    return {
      version: 2,
      totalChanges,
      sectionsChanged,
      computedAt: new Date().toISOString(),
      summary: summaryDiff,
      skills: skillsDiff,
      experience: experienceDiffs,
      keywordAnalysis,
      changes,
    };
  }

  // ---------------------------------------------------------------------------
  // Summary diff
  // ---------------------------------------------------------------------------

  private computeSummaryDiff(
    original: string,
    optimized: string,
    targetKeywords: string[],
  ): EnhancedResumeDiff['summary'] {
    const orig = (original ?? '').trim();
    const opt = (optimized ?? '').trim();

    if (!orig && !opt) return null;

    const changeType: DiffChangeType =
      orig === opt ? 'unchanged' : opt && !orig ? 'added' : 'modified';

    const addedKeywords = this.findAddedKeywords(orig, opt, targetKeywords);

    return { changeType, original: orig, optimized: opt, addedKeywords };
  }

  // ---------------------------------------------------------------------------
  // Skills diff
  // ---------------------------------------------------------------------------

  private computeSkillsDiff(
    original: TailoredContent['skills'],
    optimized: TailoredContent['skills'],
  ): EnhancedResumeDiff['skills'] {
    if (!original && !optimized) return null;

    const categories = [
      'languages',
      'frameworks',
      'tools',
      'databases',
      'concepts',
    ] as const;

    let totalAdded = 0;
    let totalRemoved = 0;
    let anyChanged = false;

    const byCategory: SkillsCategoryDiff[] = categories.map((cat) => {
      const orig: string[] =
        (original as unknown as Record<string, string[]>)?.[cat] ?? [];
      const opt: string[] =
        (optimized as unknown as Record<string, string[]>)?.[cat] ?? [];

      const origSet = new Set(orig.map((s) => s.toLowerCase()));
      const optSet = new Set(opt.map((s) => s.toLowerCase()));

      const added = opt.filter((s) => !origSet.has(s.toLowerCase()));
      const removed = orig.filter((s) => !optSet.has(s.toLowerCase()));

      totalAdded += added.length;
      totalRemoved += removed.length;

      if (added.length > 0 || removed.length > 0) anyChanged = true;

      return { category: cat, original: orig, optimized: opt, added, removed };
    });

    const changeType: DiffChangeType = anyChanged ? 'modified' : 'unchanged';

    return { changeType, byCategory, totalAdded, totalRemoved };
  }

  // ---------------------------------------------------------------------------
  // Experience diffs
  // ---------------------------------------------------------------------------

  private computeExperienceDiffs(
    original: TailoredContent['experience'],
    optimized: TailoredContent['experience'],
    targetKeywords: string[],
  ): ExperienceDiff[] {
    if (!optimized?.length) return [];

    return optimized.map((optExp, idx) => {
      const origExp = original?.[idx];

      if (!origExp) {
        return {
          company: optExp.company ?? '',
          position: optExp.position ?? '',
          changeType: 'added' as DiffChangeType,
          titleChanged: false,
          originalTitle: '',
          optimizedTitle: optExp.position ?? '',
          bulletChanges: (optExp.responsibilities ?? []).map((b) => ({
            changeType: 'added' as DiffChangeType,
            original: '',
            optimized: b,
            addedKeywords: this.findAddedKeywords('', b, targetKeywords),
            similarity: 0,
          })),
        };
      }

      const titleChanged = (origExp.position ?? '') !== (optExp.position ?? '');

      const bulletChanges = this.matchBullets(
        origExp.responsibilities ?? [],
        optExp.responsibilities ?? [],
        targetKeywords,
      );

      const hasChanges =
        titleChanged || bulletChanges.some((b) => b.changeType !== 'unchanged');

      return {
        company: optExp.company ?? origExp.company ?? '',
        position: optExp.position ?? origExp.position ?? '',
        changeType: hasChanges ? 'modified' : 'unchanged',
        titleChanged,
        originalTitle: origExp.position ?? '',
        optimizedTitle: optExp.position ?? '',
        bulletChanges,
      };
    });
  }

  /**
   * Match original bullets to optimized bullets using greedy Jaccard similarity.
   * Each original bullet is matched to the closest optimized bullet not yet claimed.
   */
  private matchBullets(
    origBullets: string[],
    optBullets: string[],
    targetKeywords: string[],
  ): BulletDiff[] {
    if (!optBullets.length) return [];

    const used = new Set<number>();
    const results: BulletDiff[] = [];

    for (const optBullet of optBullets) {
      let bestIdx = -1;
      let bestScore = -1;

      for (let i = 0; i < origBullets.length; i++) {
        if (used.has(i)) continue;
        const score = this.jaccardSimilarity(origBullets[i], optBullet);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0 && bestScore >= JACCARD_SIMILARITY_THRESHOLD) {
        used.add(bestIdx);
        const origBullet = origBullets[bestIdx];
        const addedKeywords = this.findAddedKeywords(
          origBullet,
          optBullet,
          targetKeywords,
        );
        const changeType: DiffChangeType =
          origBullet.trim() === optBullet.trim() ? 'unchanged' : 'modified';

        results.push({
          changeType,
          original: origBullet,
          optimized: optBullet,
          addedKeywords,
          similarity: Math.round(bestScore * 100) / 100,
        });
      } else {
        // No sufficiently similar original — treat as new bullet
        results.push({
          changeType: 'added',
          original: '',
          optimized: optBullet,
          addedKeywords: this.findAddedKeywords('', optBullet, targetKeywords),
          similarity: 0,
        });
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Keyword coverage
  // ---------------------------------------------------------------------------

  private computeKeywordCoverage(
    original: TailoredContent,
    optimized: TailoredContent,
    targetKeywords: string[],
    scoringInput?: ChangesDiffScoringInput,
  ): KeywordCoverageAnalysis {
    if (!targetKeywords.length) {
      return {
        targetKeywords: [],
        originalMatches: [],
        newlyAdded: [],
        stillMissing: [],
        coverageOriginal: 100,
        coverageOptimized: 100,
      };
    }

    // Per-keyword membership lists (originalMatches / newlyAdded / stillMissing)
    // are still computed via literal substring containment — they're a "did
    // this exact term appear?" diagnostic, not a holistic match score.
    const origText = this.contentToText(original).toLowerCase();
    const optText = this.contentToText(optimized).toLowerCase();

    const originalMatches = targetKeywords.filter((kw) =>
      origText.includes(kw.toLowerCase()),
    );
    const optimizedMatches = targetKeywords.filter((kw) =>
      optText.includes(kw.toLowerCase()),
    );

    const origMatchSet = new Set(originalMatches.map((k) => k.toLowerCase()));
    const optMatchSet = new Set(optimizedMatches.map((k) => k.toLowerCase()));

    const newlyAdded = targetKeywords.filter(
      (kw) =>
        optMatchSet.has(kw.toLowerCase()) &&
        !origMatchSet.has(kw.toLowerCase()),
    );
    const stillMissing = targetKeywords.filter(
      (kw) => !optMatchSet.has(kw.toLowerCase()),
    );

    // Coverage percentages: route through the unified scorer when we have
    // full scoring input (i.e. from the orchestrator, which carries the JD
    // analysis and the user's literal upload text). This guarantees
    // coverageOriginal === match_score_before and coverageOptimized ===
    // match_score_after. Without scoring input (legacy queue path) fall
    // back to the simple ratio derived from substring membership.
    let coverageOriginal: number;
    let coverageOptimized: number;

    if (scoringInput?.jobAnalysis) {
      const keywordSet = KeywordMatchScoringService.buildKeywordSet(
        scoringInput.jobAnalysis,
      );

      const beforeSource =
        scoringInput.originalText && scoringInput.originalText.length > 0
          ? scoringInput.originalText
          : original;

      coverageOriginal = this.keywordMatchScoringService.computeScore(
        beforeSource,
        keywordSet,
        undefined,
        { applyAliases: false },
      );

      coverageOptimized = this.keywordMatchScoringService.computeScore(
        optimized,
        keywordSet,
        optimized.skillAliases,
        { applyAliases: true },
      );
    } else {
      const total = targetKeywords.length;
      coverageOriginal = Math.round((originalMatches.length / total) * 100);
      coverageOptimized = Math.round((optimizedMatches.length / total) * 100);
    }

    return {
      targetKeywords,
      originalMatches,
      newlyAdded,
      stillMissing,
      coverageOriginal,
      coverageOptimized,
    };
  }

  // ---------------------------------------------------------------------------
  // Legacy flat changes array (backward compat)
  // ---------------------------------------------------------------------------

  private buildLegacyChanges(
    summaryDiff: EnhancedResumeDiff['summary'],
    skillsDiff: EnhancedResumeDiff['skills'],
    experienceDiffs: ExperienceDiff[],
  ): LegacySectionChange[] {
    const changes: LegacySectionChange[] = [];

    if (summaryDiff) {
      changes.push({
        section: 'Professional Summary',
        changeType: summaryDiff.changeType,
        original: summaryDiff.original,
        optimized: summaryDiff.optimized,
        addedKeywords: summaryDiff.addedKeywords,
      });
    }

    if (skillsDiff) {
      const allAdded = skillsDiff.byCategory.flatMap((c) => c.added);
      changes.push({
        section: 'Skills',
        changeType: skillsDiff.changeType,
        original: skillsDiff.byCategory
          .map((c) => `${c.category}: ${c.original.join(', ')}`)
          .join('; '),
        optimized: skillsDiff.byCategory
          .map((c) => `${c.category}: ${c.optimized.join(', ')}`)
          .join('; '),
        addedKeywords: allAdded,
      });
    }

    for (const expDiff of experienceDiffs) {
      const bulletAddedKeywords = expDiff.bulletChanges.flatMap(
        (b) => b.addedKeywords,
      );
      const uniqueKeywords = [...new Set(bulletAddedKeywords)];

      changes.push({
        section: `Experience - ${expDiff.company}`,
        changeType: expDiff.changeType,
        original: expDiff.bulletChanges
          .filter((b) => b.original)
          .map((b) => b.original)
          .join('\n'),
        optimized: expDiff.bulletChanges.map((b) => b.optimized).join('\n'),
        addedKeywords: uniqueKeywords,
      });
    }

    return changes;
  }

  private countSectionsChanged(
    summaryDiff: EnhancedResumeDiff['summary'],
    skillsDiff: EnhancedResumeDiff['skills'],
    experienceDiffs: ExperienceDiff[],
  ): number {
    let count = 0;
    if (summaryDiff?.changeType !== 'unchanged') count++;
    if (skillsDiff?.changeType !== 'unchanged') count++;
    count += experienceDiffs.filter((e) => e.changeType !== 'unchanged').length;
    return count;
  }

  // ---------------------------------------------------------------------------
  // Utility helpers
  // ---------------------------------------------------------------------------

  /**
   * Jaccard similarity between two strings based on word tokens.
   * Returns a value in [0, 1].
   */
  private jaccardSimilarity(a: string, b: string): number {
    const tokA = this.tokenize(a);
    const tokB = this.tokenize(b);

    if (!tokA.size && !tokB.size) return 1;
    if (!tokA.size || !tokB.size) return 0;

    const intersection = [...tokA].filter((t) => tokB.has(t)).length;
    const union = new Set([...tokA, ...tokB]).size;

    return union > 0 ? intersection / union : 0;
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .split(/\W+/)
        .filter((t) => t.length > 1),
    );
  }

  /**
   * Determine which target keywords appear in `optimized` text but not in `original` text.
   */
  private findAddedKeywords(
    original: string,
    optimized: string,
    targetKeywords: string[],
  ): string[] {
    const origLower = original.toLowerCase();
    const optLower = optimized.toLowerCase();

    return targetKeywords.filter(
      (kw) =>
        optLower.includes(kw.toLowerCase()) &&
        !origLower.includes(kw.toLowerCase()),
    );
  }

  /** Convert full resume content to a flat string for keyword matching. */
  private contentToText(content: TailoredContent): string {
    const parts: string[] = [];

    if (content.title) parts.push(content.title);
    if (content.summary) parts.push(content.summary);

    const skills = content.skills as unknown as
      | Record<string, string[]>
      | undefined;
    if (skills) {
      Object.values(skills).forEach((arr) => {
        if (Array.isArray(arr)) parts.push(arr.join(' '));
      });
    }

    for (const exp of content.experience ?? []) {
      if (exp.position) parts.push(exp.position);
      if (exp.technologies) parts.push(exp.technologies);
      for (const r of exp.responsibilities ?? []) parts.push(r);
      for (const a of exp.achievements ?? []) parts.push(a);
    }

    return parts.join(' ');
  }
}
