import { Injectable, Logger } from '@nestjs/common';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import {
  ATS_BULLET_CAPITAL_MIN_RATIO,
  ATS_TOTAL_CHECKS,
} from '../../../shared/constants/resume-tailoring.constants';

export interface AtsChecksResult {
  passed: number;
  total: number;
  failures: string[];
}

/**
 * ATS Checks Computation Service
 *
 * Runs 10 deterministic, rule-based ATS compliance checks against a
 * TailoredContent object. No AI calls are made — all logic is pure TypeScript.
 *
 * Results reflect whether the resume will parse cleanly through common
 * Applicant Tracking Systems: contact completeness, section presence,
 * date coverage, bullet quality, and formatting hygiene.
 */
@Injectable()
export class AtsChecksComputationService {
  private readonly logger = new Logger(AtsChecksComputationService.name);

  /**
   * Evaluate 10 ATS compliance checks against the provided tailored content.
   * @returns AtsChecksResult with passed count, total (always 10), and failure messages.
   */
  computeChecks(content: TailoredContent): AtsChecksResult {
    const failures: string[] = [];

    // Check 1: email present in contactInfo
    if (!content.contactInfo?.email?.trim()) {
      failures.push('Missing email in contact info');
    }

    // Check 2: phone present in contactInfo
    if (!content.contactInfo?.phone?.trim()) {
      failures.push('Missing phone number in contact info');
    }

    // Check 3: name present in contactInfo
    if (!content.contactInfo?.name?.trim()) {
      failures.push('Missing name in contact info');
    }

    // Check 4: summary non-empty
    if (!content.summary?.trim()) {
      failures.push('Summary is empty or missing');
    }

    // Check 5: skills non-empty (at least one category has at least one skill)
    const skills = content.skills as unknown as
      | Record<string, string[]>
      | undefined;
    const hasSkills =
      skills != null &&
      Object.values(skills).some((arr) => Array.isArray(arr) && arr.length > 0);
    if (!hasSkills) {
      failures.push(
        'Skills section is empty — at least one skill category must have entries',
      );
    }

    // Check 6: experience has at least one entry
    const experience = content.experience ?? [];
    if (experience.length === 0) {
      failures.push('Experience section has no entries');
    }

    // Check 7: education has at least one entry
    const education = content.education ?? [];
    if (education.length === 0) {
      failures.push('Education section has no entries');
    }

    // Check 8: all experience entries have non-empty startDate
    const missingStartDate = experience.some((exp) => !exp.startDate?.trim());
    if (missingStartDate) {
      failures.push('One or more experience entries are missing a start date');
    }

    // Collect all responsibility bullets across all experience entries
    const allBullets = experience.flatMap((exp) => exp.responsibilities ?? []);

    // Check 9: at least 80% of bullets start with a capital letter (A-Z)
    if (allBullets.length > 0) {
      const capitalised = allBullets.filter((b) => /^[A-Z]/.test(b));
      const ratio = capitalised.length / allBullets.length;
      if (ratio < ATS_BULLET_CAPITAL_MIN_RATIO) {
        const pct = Math.round(ratio * 100);
        failures.push(
          `Only ${pct}% of experience bullets start with a capital letter (minimum 80% required)`,
        );
      }
    }

    // Check 10: no empty bullets
    const hasEmptyBullet = allBullets.some((b) => !b.trim());
    if (hasEmptyBullet) {
      failures.push(
        'One or more experience bullets are empty or whitespace-only',
      );
    }

    const total = ATS_TOTAL_CHECKS;
    const passed = total - failures.length;

    this.logger.debug(
      `ATS checks complete: ${passed}/${total} passed, ${failures.length} failure(s)`,
    );

    return { passed, total, failures };
  }
}
