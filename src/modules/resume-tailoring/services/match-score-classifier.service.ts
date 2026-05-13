import { Injectable } from '@nestjs/common';
import { MatchScoreBlock } from '../interfaces/match-score-block.interface';

/**
 * Clamp an arbitrary numeric input to an integer in [0, 100].
 *
 * Defensive: incoming values from older persisted records or from the scorer
 * SHOULD already be integers in [0, MATCH_SCORE_MAX_PERCENTAGE], but the
 * classifier is the last line of defence before this number is broadcast to
 * the FE so we normalize aggressively here.
 */
function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

/**
 * Pure classifier — same logic as `MatchScoreClassifierService.classify`,
 * exposed as a static function so models (plain TypeScript classes with no
 * DI container) can call it without going through Nest's injector.
 *
 * Keep this in lockstep with `MatchScoreClassifierService.classify`. The
 * service is a thin wrapper around this function.
 *
 * Order of evaluation (matches the architecture spec):
 *  1. `after < 40`                       → `low-fit`        / `muted`
 *  2. `before >= 80 && delta < 10`       → `already-strong` / `success`
 *  3. `delta >= 10`                      → `improved`       / `success`
 *  4. otherwise                          → `flat`           / `warning`
 */
export function classifyMatchScore(
  before: number,
  after: number,
): MatchScoreBlock {
  const safeBefore = clampScore(before);
  const safeAfter = clampScore(after);
  const delta = safeAfter - safeBefore;

  if (safeAfter < 40) {
    return {
      before: safeBefore,
      after: safeAfter,
      delta,
      improvementKind: 'low-fit',
      statusColor: 'muted',
      improvementMessage:
        'Limited keyword overlap — strengthen relevant experience',
    };
  }

  if (safeBefore >= 80 && delta < 10) {
    return {
      before: safeBefore,
      after: safeAfter,
      delta,
      improvementKind: 'already-strong',
      statusColor: 'success',
      improvementMessage: 'Already a strong match — minor refinements applied',
    };
  }

  if (delta >= 10) {
    return {
      before: safeBefore,
      after: safeAfter,
      delta,
      improvementKind: 'improved',
      statusColor: 'success',
      improvementMessage: `+${delta}% improvement`,
    };
  }

  return {
    before: safeBefore,
    after: safeAfter,
    delta,
    improvementKind: 'flat',
    statusColor: 'warning',
    improvementMessage: `Match score: ${safeAfter}%`,
  };
}

/**
 * Match Score Classifier Service
 *
 * Owns the single backend-side derivation of `improvementKind`,
 * `improvementMessage`, and `statusColor`. Frontends MUST NOT replicate
 * these rules — they render the block as-is.
 *
 * Pure function of `(before, after)` integers. No private state, no
 * dependencies. Domain-knowledge of tiers / positions is deliberately out of
 * scope (see plan: "Don't extend the classifier to consider
 * job-position/tier").
 */
@Injectable()
export class MatchScoreClassifierService {
  /**
   * Build the canonical `MatchScoreBlock` from two integer scores.
   *
   * Inputs are clamped to [0, 100] defensively. `delta` is integer.
   */
  classify(before: number, after: number): MatchScoreBlock {
    return classifyMatchScore(before, after);
  }
}
