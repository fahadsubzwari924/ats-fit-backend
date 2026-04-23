import { Injectable } from '@nestjs/common';
import { Experience } from '../interfaces/resume-extracted-keywords.interface';
import { ScoredBullet } from '../interfaces/scored-bullet.interface';
import {
  BULLET_VISIBILITY_BY_RANK,
  QUANTIFIED_BULLET_REGEX,
} from '../../../shared/constants/resume-tailoring.constants';

/**
 * BulletRelevanceScoringService
 *
 * Pure scoring logic — no I/O, no side effects.
 * Shared by the resume tailoring pipeline (pre-rank bullets before LLM call)
 * and the profile question selection pipeline (identify highest-ROI bullets).
 *
 * Scoring model:
 *   relevanceScore    = TF-IDF-style keyword overlap vs JD keyword set
 *   quantificationScore = presence/strength of numeric evidence
 *   visibilityScore   = positional weight by experience rank
 *   questionValue     = relevance × (1 − quantification) × visibility
 */
@Injectable()
export class BulletRelevanceScoringService {
  /**
   * Score every bullet across all experiences against the provided JD keywords.
   *
   * @param experiences  Full experience array (ordered most-recent first)
   * @param jdKeywords   Union of primary keywords + mandatory skills + frameworks from job analysis
   */
  scoreBullets(
    experiences: Experience[],
    jdKeywords: string[],
  ): ScoredBullet[] {
    const normalizedKeywords = this.normalizeTokens(jdKeywords);
    const scored: ScoredBullet[] = [];

    for (let expIdx = 0; expIdx < experiences.length; expIdx++) {
      const exp = experiences[expIdx];
      const bullets = this.getExperienceBullets(exp);
      const visibilityScore = this.getVisibilityScore(expIdx);

      for (let bulletIdx = 0; bulletIdx < bullets.length; bulletIdx++) {
        const bulletText = bullets[bulletIdx];
        const relevanceScore = this.computeRelevanceScore(
          bulletText,
          normalizedKeywords,
        );
        const quantificationScore = this.computeQuantificationScore(bulletText);
        const questionValue =
          relevanceScore * (1 - quantificationScore) * visibilityScore;

        scored.push({
          experienceIndex: expIdx,
          bulletIndex: bulletIdx,
          bulletText,
          relevanceScore,
          quantificationScore,
          visibilityScore,
          questionValue,
        });
      }
    }

    return scored;
  }

  /**
   * Return the top-N bullets per experience, ranked by relevanceScore.
   * Used by the tailoring pipeline to build the pre-ranked bullet payload for the LLM.
   *
   * @param experiences Full experience array
   * @param jdKeywords  JD keyword union
   * @param budgetPerRank Per-experience bullet cap indexed by experience rank
   */
  getTopBulletsPerExperience(
    experiences: Experience[],
    jdKeywords: string[],
    budgetPerRank: readonly number[],
  ): Array<{ experienceIndex: number; bullets: string[] }> {
    const allScored = this.scoreBullets(experiences, jdKeywords);

    return experiences.map((_, expIdx) => {
      const budget =
        budgetPerRank[expIdx] ?? budgetPerRank[budgetPerRank.length - 1];
      const expBullets = allScored
        .filter((s) => s.experienceIndex === expIdx)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, budget)
        .sort((a, b) => a.bulletIndex - b.bulletIndex); // restore original order

      return {
        experienceIndex: expIdx,
        bullets: expBullets.map((s) => s.bulletText),
      };
    });
  }

  /** Extract combined deduped bullets from responsibilities + achievements. */
  getExperienceBullets(exp: Experience): string[] {
    const seen = new Set<string>();
    return [
      ...(exp.responsibilities ?? []),
      ...(exp.achievements ?? []),
    ].filter((bp) => {
      if (seen.has(bp)) return false;
      seen.add(bp);
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Private scoring helpers
  // ---------------------------------------------------------------------------

  private computeRelevanceScore(
    bullet: string,
    normalizedKeywords: Set<string>,
  ): number {
    if (normalizedKeywords.size === 0) return 0;
    const bulletTokens = this.normalizeTokens([bullet]);
    let matches = 0;
    for (const token of bulletTokens) {
      if (normalizedKeywords.has(token)) matches++;
    }
    // Soft cap: diminishing returns after 5 keyword hits
    const raw = matches / normalizedKeywords.size;
    return Math.min(
      1,
      raw * (normalizedKeywords.size / Math.max(normalizedKeywords.size, 5)),
    );
  }

  private computeQuantificationScore(bullet: string): number {
    if (QUANTIFIED_BULLET_REGEX.test(bullet)) {
      // Strong quantification: percentage, dollar, or multiplier
      if (/\d+%|\$[\d,]+|\d+[xX]|\d+k\+/i.test(bullet)) return 1.0;
      // Moderate: plain number present
      return 0.6;
    }
    // Named entity / proper noun without numbers — still has some specificity
    if (/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/.test(bullet)) return 0.3;
    return 0;
  }

  private getVisibilityScore(experienceIndex: number): number {
    return (
      BULLET_VISIBILITY_BY_RANK[experienceIndex] ??
      BULLET_VISIBILITY_BY_RANK[BULLET_VISIBILITY_BY_RANK.length - 1]
    );
  }

  private normalizeTokens(terms: string[]): Set<string> {
    const tokens = new Set<string>();
    for (const term of terms) {
      // Split on whitespace and punctuation, lowercase, min 2 chars
      term
        .toLowerCase()
        .split(/[\s,./\\()\-_]+/)
        .filter((t) => t.length >= 2)
        .forEach((t) => tokens.add(t));
    }
    return tokens;
  }
}
