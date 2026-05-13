/**
 * Canonical Match Score Block
 *
 * The single contract every API endpoint that returns resume-generation data
 * emits. Frontend renders directly from this shape — no FE thresholds, no
 * delta arithmetic, no fallback selection.
 *
 * Produced by `MatchScoreClassifierService` (or its pure static counterpart
 * `classifyMatchScore`).
 */

/**
 * Semantic improvement classification. Order of evaluation in the classifier:
 *   1. `low-fit`         — score below the floor (`after < 40`)
 *   2. `already-strong`  — high baseline with marginal change
 *   3. `improved`        — meaningful uplift (delta >= 10)
 *   4. `flat`            — none of the above
 */
export type MatchScoreImprovementKind =
  | 'already-strong'
  | 'improved'
  | 'low-fit'
  | 'flat';

/**
 * Semantic status color. The frontend is responsible for mapping these tokens
 * to its design-system palette — backend never speaks in hex codes.
 */
export type MatchScoreStatusColor = 'success' | 'warning' | 'muted';

/**
 * Single output contract for match scoring across the entire API surface.
 *
 * `before` / `after` are integer percentages already clamped by the scorer
 * to [0, MATCH_SCORE_MAX_PERCENTAGE]. `delta` is `after - before` rounded to
 * an integer. `improvementMessage` is ready-to-display copy (no further
 * interpolation required on the FE).
 */
export interface MatchScoreBlock {
  before: number;
  after: number;
  delta: number;
  improvementKind: MatchScoreImprovementKind;
  improvementMessage: string;
  statusColor: MatchScoreStatusColor;
}
