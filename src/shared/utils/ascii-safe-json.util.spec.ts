import { AsciiSafeJsonUtil } from './ascii-safe-json.util';

/**
 * Node.js HTTP header validation rule, mirrored from `_http_outgoing` source.
 * Header values must consist solely of HTAB plus the byte ranges 0x20-0x7E
 * (printable ASCII) and 0x80-0xFF (obsolete obs-text). Anything else trips
 * `ERR_INVALID_CHAR`. JavaScript strings are UTF-16, so the check applies to
 * code units — characters above U+00FF are rejected.
 */
const HTTP_HEADER_VALID_CHARS = /^[\t\x20-\x7e\x80-\xff]*$/;

describe('AsciiSafeJsonUtil', () => {
  describe('stringify', () => {
    it('escapes em-dash (U+2014) so the result is safe for HTTP headers', () => {
      // This is the exact production payload that triggered ERR_INVALID_CHAR.
      const matchScore = {
        before: 88,
        after: 95,
        delta: 7,
        improvementKind: 'already-strong',
        improvementMessage:
          'Already a strong match — minor refinements applied',
        statusColor: 'success',
      };

      const out = AsciiSafeJsonUtil.stringify(matchScore);

      expect(HTTP_HEADER_VALID_CHARS.test(out)).toBe(true);
      expect(out).toContain('\\u2014');
      expect(JSON.parse(out)).toEqual(matchScore);
    });

    it('escapes CJK characters', () => {
      const out = AsciiSafeJsonUtil.stringify({ msg: '你好' });

      expect(HTTP_HEADER_VALID_CHARS.test(out)).toBe(true);
      expect(out).toContain('\\u4f60');
      expect(out).toContain('\\u597d');
      expect(JSON.parse(out).msg).toBe('你好');
    });

    it('escapes emoji via surrogate pairs and round-trips', () => {
      const earth = '🌍';
      const out = AsciiSafeJsonUtil.stringify({ msg: earth });

      expect(HTTP_HEADER_VALID_CHARS.test(out)).toBe(true);
      expect(JSON.parse(out).msg).toBe(earth);
    });

    it('leaves pure ASCII payloads unchanged from JSON.stringify', () => {
      const payload = { before: 50, after: 60, msg: '+10% improvement' };

      expect(AsciiSafeJsonUtil.stringify(payload)).toBe(
        JSON.stringify(payload),
      );
    });

    it('handles nested objects with mixed non-ASCII content', () => {
      const payload = {
        outer: { inner: 'café — tést', count: 3 },
      };

      const out = AsciiSafeJsonUtil.stringify(payload);

      expect(HTTP_HEADER_VALID_CHARS.test(out)).toBe(true);
      expect(JSON.parse(out)).toEqual(payload);
    });
  });
});
