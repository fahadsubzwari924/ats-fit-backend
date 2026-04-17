import { Injectable } from '@nestjs/common';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import { QUANTIFIED_BULLET_REGEX } from '../../../shared/constants/resume-tailoring.constants';

export interface BulletsQuantifiedResult {
  before: number;
  after: number;
  total: number;
}

/**
 * Bullets Quantified Computation Service
 *
 * Counts how many responsibility/achievement bullets contain numeric patterns,
 * comparing before vs after resume tailoring.
 *
 * No AI calls — pure synchronous TypeScript.
 */
@Injectable()
export class BulletsQuantifiedComputationService {
  /**
   * Compute quantified bullet counts for original and optimized resume content.
   *
   * @param before - Original candidate resume content
   * @param after  - AI-optimized resume content
   * @returns before count, after count, and total bullets in after content
   */
  computeQuantified(
    before: TailoredContent,
    after: TailoredContent,
  ): BulletsQuantifiedResult {
    const beforeBullets = this.extractBullets(before);
    const afterBullets = this.extractBullets(after);

    return {
      before: this.countQuantified(beforeBullets),
      after: this.countQuantified(afterBullets),
      total: afterBullets.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Collect all responsibility and achievement bullets from every experience entry.
   */
  private extractBullets(content: TailoredContent): string[] {
    const bullets: string[] = [];

    for (const exp of content.experience ?? []) {
      for (const r of exp.responsibilities ?? []) {
        bullets.push(r);
      }
      for (const a of exp.achievements ?? []) {
        bullets.push(a);
      }
    }

    return bullets;
  }

  /**
   * Count bullets that match the quantified pattern (numbers, percentages,
   * dollar amounts, or multipliers).
   */
  private countQuantified(bullets: string[]): number {
    return bullets.filter((bullet) => QUANTIFIED_BULLET_REGEX.test(bullet))
      .length;
  }
}
