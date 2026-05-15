/**
 * ASCII-safe JSON encoding for HTTP header values.
 *
 * Node.js `http.OutgoingMessage.setHeader` validates each header value against
 * the byte range `[\t\x20-\x7e\x80-\xff]` and throws `ERR_INVALID_CHAR` on any
 * character outside it (RFC 7230 section 3.2 plus Node's stricter
 * interpretation).
 *
 * `JSON.stringify` leaves most non-ASCII characters (em-dash U+2014, smart
 * quotes, emoji, CJK, etc.) as literal code points, so any structured payload
 * carrying human-readable copy can crash the response. This helper escapes
 * every code point above U+007F as `\uXXXX`, producing pure-ASCII output that
 * is still valid JSON. `JSON.parse` on the client unescapes transparently.
 *
 * Equivalent to Python's `json.dumps(obj, ensure_ascii=True)`.
 */
// Matches any UTF-16 code unit above 0x7F. Code points above U+FFFF in the
// source value are stored as a surrogate pair and matched (and escaped) as
// two code units, which `JSON.parse` reassembles correctly.
const NON_ASCII_CODE_UNIT_RE = new RegExp('[\\u0080-\\uffff]', 'g');

export class AsciiSafeJsonUtil {
  /**
   * Stringify `value` to JSON with every non-ASCII code point escaped as
   * `\uXXXX`. Safe to pass directly to `res.set(...)` / `res.setHeader(...)`.
   */
  static stringify(value: unknown): string {
    return JSON.stringify(value).replace(
      NON_ASCII_CODE_UNIT_RE,
      (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'),
    );
  }
}
