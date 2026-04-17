import { Response } from 'express';
import { ResumeGenerationResult } from '../interfaces/resume-generation.interface';

/**
 * Maps a ResumeGenerationResult to the HTTP response headers sent to the client.
 *
 * The PDF endpoint streams a binary body, so all metadata is transported via
 * custom X-* headers. This class owns that mapping so the controller stays thin.
 */
export class TailoredResumeResponseMapper {
  /**
   * Apply all PDF-download response headers derived from the generation result.
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
      'X-Ats-Checks-Passed': result.atsChecksPassed.toString(),
      'X-Ats-Checks-Total': result.atsChecksTotal.toString(),
      'X-Bullets-Quantified-Before': result.bulletsQuantifiedBefore.toString(),
      'X-Bullets-Quantified-After': result.bulletsQuantifiedAfter.toString(),
      'X-Bullets-Quantified-Total': result.bulletsQuantifiedTotal.toString(),
    });
  }
}
