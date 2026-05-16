import { Injectable } from '@nestjs/common';
import { KeywordMatchScoringService } from '../../resume-tailoring/services/keyword-match-scoring.service';
import { JOB_RELEVANCE_CONSTANTS } from '../constants/job-relevance.constants';
import { JobRelevanceVerdict } from '../enums/job-relevance-verdict.enum';
import { JobRelevanceEngine } from '../enums/job-relevance-engine.enum';
import { JobRelevanceDimensionLabel } from '../enums/job-relevance-dimension-label.enum';
import type { JobRelevanceResult } from '../interfaces/job-relevance.interface';

/**
 * Extracts a deduplicated keyword set from a raw job-description string.
 * Splits on whitespace/punctuation, strips short stop-words (length <= 2),
 * and deduplicates by lowercase value so the scorer treats every unique token
 * as one keyword term.
 */
function buildKeywordSetFromText(
  text: string,
): Array<{ term: string; aliases?: string[] }> {
  if (!text) return [];

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const seen = new Set<string>();
  const result: Array<{ term: string; aliases?: string[] }> = [];
  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word);
      result.push({ term: word });
    }
  }
  return result;
}

@Injectable()
export class JobRelevanceKeywordFastPathService {
  constructor(private readonly keywordScorer: KeywordMatchScoringService) {}

  tryScore(
    profileText: string,
    jobDescription: string,
  ): JobRelevanceResult | null {
    const keywordSet = buildKeywordSetFromText(jobDescription);
    if (keywordSet.length === 0) return null;

    let raw: number;
    try {
      raw = this.keywordScorer.computeScore(profileText, keywordSet);
    } catch {
      return null;
    }
    const overlap = Math.min(100, Math.max(0, Math.round(raw)));

    const { HIGH_SKIP_THRESHOLD, LOW_SKIP_THRESHOLD } =
      JOB_RELEVANCE_CONSTANTS.KEYWORD_FAST_PATH;

    if (overlap >= HIGH_SKIP_THRESHOLD) {
      return this.buildSynthetic(
        overlap,
        JobRelevanceVerdict.HIGH,
        [],
        ['Strong keyword overlap between profile and job description'],
        JobRelevanceDimensionLabel.ALIGNED,
      );
    }

    if (overlap <= LOW_SKIP_THRESHOLD) {
      return this.buildSynthetic(
        overlap,
        JobRelevanceVerdict.LOW,
        ['Profile keywords show minimal overlap with this job description'],
        [],
        JobRelevanceDimensionLabel.MISMATCH,
      );
    }

    return null;
  }

  private buildSynthetic(
    score: number,
    verdict: JobRelevanceVerdict,
    gaps: string[],
    strengths: string[],
    dimLabel: JobRelevanceDimensionLabel,
  ): JobRelevanceResult {
    return {
      score,
      verdict,
      dimensions: {
        techStack: { score, label: dimLabel },
        roleType: { score, label: dimLabel },
        experienceLevel: { score, label: dimLabel },
      },
      gaps,
      strengths,
      engine: JobRelevanceEngine.KEYWORD_FAST_PATH,
      model: null,
      latencyMs: 0,
      cacheKey: null,
      computedAt: new Date().toISOString(),
      acknowledgedLowFit: false,
    };
  }
}
