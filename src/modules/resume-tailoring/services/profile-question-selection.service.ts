import { Injectable } from '@nestjs/common';
import { Experience } from '../interfaces/resume-extracted-keywords.interface';
import { BulletContext } from '../interfaces/bullet-context.interface';
import { ScoredBullet } from '../interfaces/scored-bullet.interface';
import {
  MAX_QUESTIONS_TOTAL,
  QUESTION_BUDGET_PER_RANK,
  FLEX_REDISTRIBUTE_CAP,
  MIN_QUESTION_VALUE,
  ESTIMATED_SEC_PER_QUESTION,
  MAX_TOTAL_MINUTES,
} from '../../../shared/constants/resume-tailoring.constants';
import { BulletRelevanceScoringService } from './bullet-relevance-scoring.service';

/**
 * ProfileQuestionSelectionService
 *
 * Decides WHICH bullets receive profile questions using relevance-weighted scoring
 * (Option B pipeline). Budget is distributed across experiences by rank with
 * redistribution and a time gate to respect user attention.
 *
 * Algorithm:
 *  1. Rank top-5 experiences by tenure + recency
 *  2. Score all bullets via BulletRelevanceScoringService using JD keywords
 *  3. Per experience: filter bullets by MIN_QUESTION_VALUE, take top QUESTION_BUDGET_PER_RANK[i]
 *  4. Redistribute unused slots to top-2 jobs (cap FLEX_REDISTRIBUTE_CAP each)
 *  5. Apply time gate: trim lowest-value questions until ≤ MAX_TOTAL_MINUTES
 *  6. Return flat list sorted by questionValue desc (single unified list shown to user)
 */
@Injectable()
export class ProfileQuestionSelectionService {
  private static readonly MAX_RANKED_EXPERIENCES = 5;

  constructor(
    private readonly bulletRelevanceScoringService: BulletRelevanceScoringService,
  ) {}

  /**
   * Build ordered flat list of bullet contexts eligible for question generation.
   *
   * @param experiences Full experience array from structured resume content
   * @param jdKeywords  Union of JD primary keywords + mandatory skills + frameworks.
   *                    When empty (called before job analysis), scoring falls back
   *                    to visibility-only with neutral relevance.
   */
  selectBulletContextsForQuestions(
    experiences: Experience[],
    jdKeywords: string[] = [],
  ): BulletContext[] {
    if (experiences.length === 0) return [];

    // Step 1: rank top-5 by tenure + recency
    const rankedExperiences = this.rankExperiences(experiences).slice(
      0,
      ProfileQuestionSelectionService.MAX_RANKED_EXPERIENCES,
    );

    // Step 2: score all bullets against JD keywords
    const allScored = this.bulletRelevanceScoringService.scoreBullets(
      experiences,
      jdKeywords,
    );

    // Step 3: apply per-experience budget
    const perExpSelected: BulletContext[][] = rankedExperiences.map(
      (exp, rankIdx) => {
        const originalIndex = experiences.indexOf(exp);
        const budget =
          QUESTION_BUDGET_PER_RANK[rankIdx] ??
          QUESTION_BUDGET_PER_RANK[QUESTION_BUDGET_PER_RANK.length - 1];

        return allScored
          .filter(
            (s) =>
              s.experienceIndex === originalIndex &&
              s.questionValue >= MIN_QUESTION_VALUE,
          )
          .sort((a, b) => b.questionValue - a.questionValue)
          .slice(0, budget)
          .map((s) => this.toBulletContext(s, exp.position, originalIndex));
      },
    );

    // Step 4: redistribute unused slots to top-2 jobs
    const totalSelected = perExpSelected.reduce((n, arr) => n + arr.length, 0);
    if (totalSelected < MAX_QUESTIONS_TOTAL) {
      this.redistributeUnusedSlots(
        perExpSelected,
        allScored,
        rankedExperiences,
        experiences,
        MAX_QUESTIONS_TOTAL - totalSelected,
      );
    }

    const selected: BulletContext[] = [];
    perExpSelected.forEach((arr) => selected.push(...arr));

    // Step 5: time gate
    const timeGated = this.applyTimeGate(selected);

    // Step 6: flat list sorted by questionValue desc
    return timeGated.sort((a, b) => b.questionValue - a.questionValue);
  }

  /**
   * Legacy compatibility: select experiences for question generation.
   * Kept for callers that still use the two-step API.
   */
  selectExperiencesForQuestions(experiences: Experience[]): Experience[] {
    return this.rankExperiences(experiences).slice(
      0,
      ProfileQuestionSelectionService.MAX_RANKED_EXPERIENCES,
    );
  }

  /**
   * Legacy compatibility: build bullet contexts from pre-selected experiences.
   * Falls back to neutral relevance (no JD keywords).
   */
  buildBulletContexts(
    experiences: Experience[],
    selectedExperiences: Experience[],
  ): BulletContext[] {
    return this.selectBulletContextsForQuestions(experiences).filter((ctx) =>
      selectedExperiences.some(
        (exp) => experiences.indexOf(exp) === ctx.workExperienceIndex,
      ),
    );
  }

  getExperienceBullets(exp: Experience): string[] {
    return this.bulletRelevanceScoringService.getExperienceBullets(exp);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private rankExperiences(experiences: Experience[]): Experience[] {
    return [...experiences]
      .map((exp) => {
        const tenureMonths = this.calcTenureMonths(exp.startDate, exp.endDate);
        const monthsSinceEnd = this.calcMonthsSinceEnd(exp.endDate);
        const recencyScore = Math.max(0, 100 - monthsSinceEnd);
        const score =
          tenureMonths * 0.4 +
          recencyScore * 0.4 +
          this.getExperienceBullets(exp).length * 0.2;
        return { exp, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((e) => e.exp);
  }

  private redistributeUnusedSlots(
    perExpSelected: BulletContext[][],
    allScored: ScoredBullet[],
    rankedExperiences: Experience[],
    experiences: Experience[],
    unusedSlots: number,
  ): void {
    for (
      let rankIdx = 0;
      rankIdx < Math.min(2, rankedExperiences.length);
      rankIdx++
    ) {
      if (unusedSlots <= 0) break;
      const exp = rankedExperiences[rankIdx];
      const originalIndex = experiences.indexOf(exp);
      const alreadySelected = new Set(
        perExpSelected[rankIdx].map((ctx) => ctx.bulletPointIndex),
      );
      const canAdd = Math.min(
        unusedSlots,
        FLEX_REDISTRIBUTE_CAP - perExpSelected[rankIdx].length,
      );
      if (canAdd <= 0) continue;

      const extras = allScored
        .filter(
          (s) =>
            s.experienceIndex === originalIndex &&
            !alreadySelected.has(s.bulletIndex) &&
            s.questionValue >= MIN_QUESTION_VALUE,
        )
        .sort((a, b) => b.questionValue - a.questionValue)
        .slice(0, canAdd);

      extras.forEach((s) => {
        perExpSelected[rankIdx].push(
          this.toBulletContext(s, exp.position, originalIndex),
        );
      });
      unusedSlots -= extras.length;
    }
  }

  private applyTimeGate(contexts: BulletContext[]): BulletContext[] {
    const maxSeconds = MAX_TOTAL_MINUTES * 60;
    if (contexts.length * ESTIMATED_SEC_PER_QUESTION <= maxSeconds) {
      return contexts;
    }
    const maxCount = Math.floor(maxSeconds / ESTIMATED_SEC_PER_QUESTION);
    return [...contexts]
      .sort((a, b) => b.questionValue - a.questionValue)
      .slice(0, Math.min(maxCount, MAX_QUESTIONS_TOTAL));
  }

  private toBulletContext(
    scored: ScoredBullet,
    positionTitle: string | undefined,
    originalExpIndex: number,
  ): BulletContext {
    return {
      workExperienceIndex: originalExpIndex,
      bulletPointIndex: scored.bulletIndex,
      originalBulletPoint: scored.bulletText,
      positionTitle,
      questionValue: scored.questionValue,
    };
  }

  calcTenureMonths(startDate: string, endDate: string): number {
    const start = this.parseMonth(startDate);
    const end = this.parseMonth(endDate);
    if (!start || !end) return 0;
    return Math.max(
      0,
      (end.getFullYear() - start.getFullYear()) * 12 +
        (end.getMonth() - start.getMonth()),
    );
  }

  calcMonthsSinceEnd(endDate: string): number {
    const end = this.parseMonth(endDate);
    if (!end) return 0;
    const now = new Date();
    return (
      (now.getFullYear() - end.getFullYear()) * 12 +
      (now.getMonth() - end.getMonth())
    );
  }

  parseMonth(dateStr: string): Date | null {
    if (!dateStr) return null;
    const match = dateStr.match(/^(\d{4})-(\d{2})/);
    if (match)
      return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, 1);
    const y = dateStr.match(/\d{4}/)?.[0];
    const m = dateStr.match(/\d{1,2}/)?.[0];
    if (y && m) return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
    return null;
  }
}
