import { Response } from 'express';
import { TailoredResumeResponseMapper } from './tailored-resume-response.mapper';
import { ResumeGenerationResult } from '../interfaces/resume-generation.interface';

/** Mirrors Node's `_http_outgoing` validation. Anything outside this range
 *  causes `setHeader` to throw `ERR_INVALID_CHAR`. */
const HTTP_HEADER_VALID_CHARS = /^[\t\x20-\x7e\x80-\xff]*$/;

function buildResult(
  overrides: Partial<ResumeGenerationResult> = {},
): ResumeGenerationResult {
  return {
    pdfContent: '',
    filename: 'resume.pdf',
    resumeGenerationId: 'gen-1',
    keywordsAdded: 0,
    sectionsChanged: 0,
    sectionsOptimized: 0,
    achievementsQuantified: 0,
    optimizationConfidence: 0,
    processingMetrics: {
      validationTimeMs: 0,
      parallelOperationsTimeMs: 0,
      optimizationTimeMs: 0,
      pdfGenerationTimeMs: 0,
      dbSaveTimeMs: 0,
      totalProcessingTimeMs: 0,
    },
    contentSource: 'database_existing',
    pdfSizeBytes: 0,
    templateUsed: 't1',
    primaryKeywordsFound: 0,
    mandatorySkillsAligned: 0,
    matchScore: {
      before: 88,
      after: 95,
      delta: 7,
      improvementKind: 'already-strong',
      improvementMessage: 'Already a strong match — minor refinements applied',
      statusColor: 'success',
    },
    matchScoreBefore: 88,
    matchScoreAfter: 95,
    matchScoreDelta: 7,
    atsChecksPassed: 0,
    atsChecksTotal: 0,
    bulletsQuantifiedBefore: 0,
    bulletsQuantifiedAfter: 0,
    bulletsQuantifiedTotal: 0,
    ...overrides,
  };
}

describe('TailoredResumeResponseMapper', () => {
  describe('applyHeaders', () => {
    /**
     * Regression test for ERR_INVALID_CHAR. The em-dash (U+2014) in the
     * `improvementMessage` produced by the classifier used to crash
     * `res.set` when fed through raw `JSON.stringify`. Header values must
     * stay within Node's HTTP header byte range.
     */
    it('produces an ASCII-only X-Match-Score header even when matchScore.improvementMessage contains an em-dash (U+2014)', () => {
      const captured: Record<string, string> = {};
      const res = {
        set: jest.fn((headers: Record<string, string>) => {
          Object.assign(captured, headers);
        }),
      } as unknown as Response;

      TailoredResumeResponseMapper.applyHeaders(res, buildResult(), 1024);

      const matchScoreHeader = captured['X-Match-Score'];
      expect(matchScoreHeader).toBeDefined();
      expect(HTTP_HEADER_VALID_CHARS.test(matchScoreHeader)).toBe(true);
      // The em-dash must have been escaped, not stripped.
      expect(matchScoreHeader).toContain('\\u2014');
      // Round-trips cleanly to the original block.
      expect(JSON.parse(matchScoreHeader).improvementMessage).toBe(
        'Already a strong match — minor refinements applied',
      );
    });

    it('emits flat backwards-compat score headers as plain ASCII numbers', () => {
      const captured: Record<string, string> = {};
      const res = {
        set: jest.fn((headers: Record<string, string>) => {
          Object.assign(captured, headers);
        }),
      } as unknown as Response;

      TailoredResumeResponseMapper.applyHeaders(res, buildResult(), 1024);

      expect(captured['X-Match-Score-Before']).toBe('88');
      expect(captured['X-Match-Score-After']).toBe('95');
      expect(captured['X-Match-Score-Delta']).toBe('7');
    });
  });
});
