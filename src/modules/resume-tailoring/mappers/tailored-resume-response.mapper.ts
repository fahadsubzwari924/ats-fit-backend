import { Response } from 'express';
import { ResumeGenerationResult } from '../interfaces/resume-generation.interface';
import { MatchScoreBlock } from '../interfaces/match-score-block.interface';

/**
 * JSON envelope shape returned by `buildJsonEnvelope`. Used by JSON-only
 * variants of the single-tailoring endpoint and (in transition) consumed by
 * the FE alongside the existing X-* headers.
 */
export interface TailoredResumeJsonEnvelope {
  resumeGenerationId: string;
  filename: string;
  tailoringMode: string;
  keywordsAdded: number;
  sectionsOptimized: number;
  achievementsQuantified: number;
  matchScore: MatchScoreBlock;
  atsChecks: { passed: number; total: number };
  bulletsQuantified: { before: number; after: number; total: number };
}

/**
 * Maps a ResumeGenerationResult to the HTTP response headers (and JSON
 * envelope) sent to the client.
 *
 * The PDF endpoint streams a binary body, so all metadata is transported via
 * custom X-* headers — including a JSON-encoded `X-Match-Score` header that
 * carries the canonical `MatchScoreBlock` for the FE batch flow.
 *
 * `buildJsonEnvelope` returns the same metadata in a JSON-friendly shape for
 * any non-PDF endpoint that needs to broadcast the same data.
 */
export class TailoredResumeResponseMapper {
  /**
   * Apply all PDF-download response headers derived from the generation result.
   *
   * The canonical `MatchScoreBlock` is encoded as JSON under
   * `X-Match-Score` for one-shot reads on the FE. Flat
   * `X-Match-Score-Before/After/Delta` headers stay for backwards compat
   * with mid-deploy FE versions — TODO: remove after FE migration lands.
   */
  static applyHeaders(
    res: Response,
    result: ResumeGenerationResult,
    contentLength: number,
  ): void {
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=${result.filename}`,
      'Content-Length': contentLength.toString(),
      'X-Resume-Generation-Id': result.resumeGenerationId,
      'X-Filename': result.filename,
      'X-Tailoring-Mode': result.tailoringMode ?? 'standard',
      'X-Keywords-Added': result.keywordsAdded.toString(),
      'X-Sections-Optimized': result.sectionsOptimized.toString(),
      'X-Achievements-Quantified': result.achievementsQuantified.toString(),
      'X-Optimization-Confidence': '0',
      'X-Match-Score-Before': result.matchScoreBefore.toString(),
      'X-Match-Score-After': result.matchScoreAfter.toString(),
      'X-Match-Score-Delta': result.matchScoreDelta.toString(),
      'X-Match-Score': JSON.stringify(result.matchScore),
      'X-Ats-Checks-Passed': result.atsChecksPassed.toString(),
      'X-Ats-Checks-Total': result.atsChecksTotal.toString(),
      'X-Bullets-Quantified-Before': result.bulletsQuantifiedBefore.toString(),
      'X-Bullets-Quantified-After': result.bulletsQuantifiedAfter.toString(),
      'X-Bullets-Quantified-Total': result.bulletsQuantifiedTotal.toString(),
    });
  }

  /**
   * Build a JSON envelope mirroring the X-* header set. Returned by any
   * JSON-only variant of the single-tailoring endpoint and consumed by the
   * FE as the single source of truth for match-score data.
   */
  static buildJsonEnvelope(
    result: ResumeGenerationResult,
  ): TailoredResumeJsonEnvelope {
    return {
      resumeGenerationId: result.resumeGenerationId,
      filename: result.filename,
      tailoringMode: result.tailoringMode ?? 'standard',
      keywordsAdded: result.keywordsAdded,
      sectionsOptimized: result.sectionsOptimized,
      achievementsQuantified: result.achievementsQuantified,
      matchScore: result.matchScore,
      atsChecks: {
        passed: result.atsChecksPassed,
        total: result.atsChecksTotal,
      },
      bulletsQuantified: {
        before: result.bulletsQuantifiedBefore,
        after: result.bulletsQuantifiedAfter,
        total: result.bulletsQuantifiedTotal,
      },
    };
  }
}
