import { Injectable } from '@nestjs/common';
import { Experience } from '../interfaces/resume-extracted-keywords.interface';

/**
 * Context for a bullet point selected for profile question generation.
 */
export interface BulletContext {
  workExperienceIndex: number;
  bulletPointIndex: number;
  originalBulletPoint: string;
  positionTitle?: string;
}

/**
 * Profile Question Selection Service
 *
 * Single responsibility: select which work experiences and bullet points
 * should receive profile questions. Pure business logic, no I/O.
 * Follows SRP and is easily unit-testable.
 */
@Injectable()
export class ProfileQuestionSelectionService {
  private static readonly QUANTIFIED_PATTERN =
    /\d+[%xX]?|\$[\d,]+|[\d,]+(k|M)?\s+(users|engineers|teams|clients|requests)/i;

  private static readonly MAX_EXPERIENCES = 3;
  private static readonly MAX_BULLETS_PER_EXPERIENCE = 3;
  private static readonly MAX_QUESTIONS_TOTAL = 12;

  /**
   * Select up to three work experiences most relevant for question generation.
   * Uses tenure, recency, and bullet count; applies swap rule for substance over recency.
   */
  selectExperiencesForQuestions(experiences: Experience[]): Experience[] {
    if (experiences.length === 0) return [];

    const scored = experiences.map((exp) => {
      const tenureMonths = this.calcTenureMonths(exp.startDate, exp.endDate);
      const monthsSinceEnd = this.calcMonthsSinceEnd(exp.endDate);
      const recencyScore = Math.max(0, 100 - monthsSinceEnd);
      const relevanceScore =
        tenureMonths * 0.4 +
        recencyScore * 0.4 +
        this.getExperienceBullets(exp).length * 0.2;
      return { exp, tenureMonths, relevanceScore };
    });

    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
    let selected = scored.slice(
      0,
      ProfileQuestionSelectionService.MAX_EXPERIENCES,
    );

    if (
      scored.length >= 4 &&
      selected[2].tenureMonths < 6 &&
      scored[3].tenureMonths > 24
    ) {
      selected = [selected[0], selected[1], scored[3]];
    }

    return selected.map((s) => s.exp);
  }

  /**
   * Select bullet point indices that need questions (skip already quantified).
   * Returns up to MAX_BULLETS_PER_EXPERIENCE indices per experience.
   */
  selectBulletPointsForQuestions(bulletPoints: string[]): number[] {
    return bulletPoints
      .map((bp, idx) => ({ bp, idx }))
      .filter(
        ({ bp }) =>
          !ProfileQuestionSelectionService.QUANTIFIED_PATTERN.test(bp),
      )
      .slice(0, ProfileQuestionSelectionService.MAX_BULLETS_PER_EXPERIENCE)
      .map(({ idx }) => idx);
  }

  /**
   * Build bullet contexts for selected experiences and bullets.
   * Used as input to the profile question generation prompt.
   */
  buildBulletContexts(
    experiences: Experience[],
    selectedExperiences: Experience[],
  ): BulletContext[] {
    const contexts: BulletContext[] = [];

    for (const exp of selectedExperiences) {
      const originalIndex = experiences.indexOf(exp);
      const bullets = this.getExperienceBullets(exp);
      const indices = this.selectBulletPointsForQuestions(bullets);

      for (const bulletIdx of indices) {
        contexts.push({
          workExperienceIndex: originalIndex,
          bulletPointIndex: bulletIdx,
          originalBulletPoint: bullets[bulletIdx],
          positionTitle: exp.position,
        });
      }
    }

    return contexts.slice(
      0,
      ProfileQuestionSelectionService.MAX_QUESTIONS_TOTAL,
    );
  }

  /**
   * Returns the combined, deduplicated bullet points for an experience entry.
   *
   * AI extraction models may populate `responsibilities`, `achievements`, or both.
   * Merging both fields ensures question generation works regardless of which
   * field the model chose to use.
   */
  getExperienceBullets(exp: Experience): string[] {
    const responsibilities = exp.responsibilities ?? [];
    const achievements = exp.achievements ?? [];
    const seen = new Set<string>();
    return [...responsibilities, ...achievements].filter((bp) => {
      if (seen.has(bp)) return false;
      seen.add(bp);
      return true;
    });
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
