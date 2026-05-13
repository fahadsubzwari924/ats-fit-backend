import { Injectable } from '@nestjs/common';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';
import { MATCH_SCORE_MAX_PERCENTAGE } from '../../../shared/constants/resume-tailoring.constants';
import { JobAnalysisResult } from '../interfaces/job-analysis.interface';

/**
 * Universal alias safety net (Layer 3).
 *
 * Tiny hardcoded map of universal abbreviations / well-known phrasings. This is
 * a last-resort fallback for cases the LLM-emitted JD/resume aliases miss. Keep
 * this list intentionally short — domain-specific aliases belong in the LLM
 * alias output, not here.
 *
 * Keys MUST be lowercase. Values MUST be lowercase.
 */
export const UNIVERSAL_ALIAS_MAP: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    k8s: ['kubernetes'],
    kubernetes: ['k8s'],
    'ci/cd': [
      'continuous integration',
      'continuous delivery',
      'continuous deployment',
    ],
    'continuous integration': ['ci/cd', 'ci'],
    postgres: ['postgresql', 'pg'],
    postgresql: ['postgres', 'pg'],
    js: ['javascript'],
    javascript: ['js'],
    ts: ['typescript'],
    typescript: ['ts'],
    rest: ['restful', 'rest api', 'restful api'],
    restful: ['rest', 'rest api'],
    node: ['nodejs', 'node.js'],
    nodejs: ['node', 'node.js'],
    'node.js': ['node', 'nodejs'],
    'full stack': ['full-stack', 'fullstack'],
    'full-stack': ['full stack', 'fullstack'],
    fullstack: ['full stack', 'full-stack'],
    aws: ['amazon web services'],
    'amazon web services': ['aws'],
    gcp: ['google cloud platform', 'google cloud'],
    nlp: ['natural language processing'],
    ml: ['machine learning'],
    ai: ['artificial intelligence'],
    db: ['database'],
  });

/**
 * Inline Porter-lite stemmer.
 *
 * NOT a full Porter implementation — only handles the suffixes that matter for
 * our resume/JD vocabulary (leadership↔lead, optimization↔optim, companies↔company,
 * leading↔lead, etc.). Applies suffix rules iteratively up to MAX_PASSES so
 * chained suffixes (leadership → leader → lead) collapse correctly.
 *
 * Each rule has a minimum-stem-length guard so we don't shred short tokens
 * like `js`, `os`, `api`.
 */
const STEMMER_MAX_PASSES = 3;

function applyStemRule(token: string): string {
  // Order matters: try longest / most specific suffixes first within a pass.
  // -ation, -tion, -sion → '' (optimization → optimiz, integration → integr)
  if (token.length >= 7 && token.endsWith('ation')) {
    return token.slice(0, -5);
  }
  if (token.length >= 6 && token.endsWith('tion')) {
    return token.slice(0, -4);
  }
  if (token.length >= 6 && token.endsWith('sion')) {
    return token.slice(0, -4);
  }
  // -ship → '' (leadership → leader)
  if (token.length >= 7 && token.endsWith('ship')) {
    return token.slice(0, -4);
  }
  // -ies → -y (companies → company)
  if (token.length >= 5 && token.endsWith('ies')) {
    return token.slice(0, -3) + 'y';
  }
  // -ied → -y (qualified → qualify) — guard so 'died' / 'tied' survive
  if (token.length >= 5 && token.endsWith('ied')) {
    return token.slice(0, -3) + 'y';
  }
  // -ing → '' (leading → lead, optimizing → optimiz)
  if (token.length >= 6 && token.endsWith('ing')) {
    return token.slice(0, -3);
  }
  // -ed → '' (designed → design)
  if (token.length >= 5 && token.endsWith('ed')) {
    return token.slice(0, -2);
  }
  // -ure → '' (architecture → architect)
  if (token.length >= 6 && token.endsWith('ure')) {
    return token.slice(0, -3);
  }
  // -er, -or → '' (leader → lead, architect stays unchanged)
  if (token.length >= 5 && token.endsWith('er')) {
    return token.slice(0, -2);
  }
  if (token.length >= 5 && token.endsWith('or')) {
    return token.slice(0, -2);
  }
  // -ly → '' (quickly → quick) — guard min 5 so 'fly' / 'ally' survive
  if (token.length >= 5 && token.endsWith('ly')) {
    return token.slice(0, -2);
  }
  // -es → '' (databases → database) — guard min 4
  if (token.length >= 4 && token.endsWith('es')) {
    return token.slice(0, -2);
  }
  // -s → '' (apis → api) — guard min 3 so js / os / ai survive
  if (token.length >= 4 && token.endsWith('s')) {
    return token.slice(0, -1);
  }
  return token;
}

export function stem(token: string): string {
  let current = token;
  for (let pass = 0; pass < STEMMER_MAX_PASSES; pass++) {
    const next = applyStemRule(current);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Normalize text for matching: lowercase, strip punctuation (preserve + # .),
 * collapse hyphens to whitespace, collapse runs of whitespace.
 */
function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(normalized: string): string[] {
  if (!normalized) return [];
  return normalized.split(' ').filter((t) => t.length > 0);
}

function stemTokens(tokens: string[]): string[] {
  return tokens.map((t) => stem(t));
}

/**
 * KeywordMatchScoringService
 *
 * Three-layer scorer that replaces the legacy substring-overlap heuristic.
 *
 * Layer 1 — Tokenization: normalize + Porter-lite stem + per-phrase token
 *   overlap with partial credit and a bigram adjacency bonus.
 * Layer 2 — Alias expansion: callers pass JD-side `aliases` (per keyword) and
 *   optionally resume-side `candidateSkillAliases`. Both expand the matchable
 *   surface deterministically.
 * Layer 3 — Universal safety net: `UNIVERSAL_ALIAS_MAP` catches well-known
 *   abbreviations that an LLM may have missed.
 *
 * Public contract: returns an integer in [0, MATCH_SCORE_MAX_PERCENTAGE]. If
 * `keywordSet` is empty, returns 0. Degrades gracefully when aliases are
 * absent (falls back to Layer 1 + Layer 3 only).
 */
@Injectable()
export class KeywordMatchScoringService {
  /**
   * Compute the keyword match score for the given content against the supplied
   * keyword set.
   *
   * @param content Either structured TailoredContent (post-optimization) or a
   *   pre-flattened string (used for the "before" score when only raw text
   *   exists). When given a string it is used as-is (after normalization).
   * @param keywordSet The set of target keywords plus optional JD-side aliases.
   * @param candidateSkillAliases Optional resume-side aliases (used to expand
   *   the matchable surface on the candidate side). Ignored when
   *   `options.applyAliases === false`.
   * @param options Scoring options. `applyAliases` (default `true`) controls
   *   whether per-keyword aliases, candidate skill aliases, and the universal
   *   safety-net map participate in matching. Set to `false` for the literal
   *   ATS-scanner view used on the user's uploaded resume text.
   */
  computeScore(
    content: TailoredContent | string,
    keywordSet: Array<{ term: string; aliases?: string[] }>,
    candidateSkillAliases?: Array<{ skill: string; alternatives: string[] }>,
    options?: { applyAliases?: boolean },
  ): number {
    if (!keywordSet || keywordSet.length === 0) return 0;

    // When `applyAliases` is false the scorer becomes the "literal ATS scanner"
    // view: token-overlap + Porter-lite stemming + bigram bonus still apply
    // (those are NORMALIZATION, not aliasing), but candidate-side alias blobs,
    // keyword-side aliases, and the universal safety-net map are all bypassed.
    // Used for the `before` score against the user's literal uploaded text.
    const applyAliases = options?.applyAliases !== false;

    const effectiveCandidateAliases = applyAliases
      ? candidateSkillAliases
      : undefined;

    const flattened = this.flattenContent(content, effectiveCandidateAliases);
    const normalizedResume = normalizeText(flattened);
    const resumeTokens = tokenize(normalizedResume);
    const stemmedResumeTokens = stemTokens(resumeTokens);
    const stemmedResumeSet = new Set(stemmedResumeTokens);

    // Dedup keywordSet by lowercase term so the same keyword does not get
    // double-counted (the orchestrator merges `primary` + `mandatorySkills`).
    const seenTerms = new Set<string>();
    const dedupedKeywords: Array<{ term: string; aliases?: string[] }> = [];
    for (const kw of keywordSet) {
      if (!kw?.term) continue;
      const key = kw.term.trim().toLowerCase();
      if (!key || seenTerms.has(key)) continue;
      seenTerms.add(key);
      dedupedKeywords.push(kw);
    }
    if (dedupedKeywords.length === 0) return 0;

    let total = 0;
    for (const kw of dedupedKeywords) {
      total += this.scoreSingleKeyword(
        kw,
        stemmedResumeTokens,
        stemmedResumeSet,
        applyAliases,
      );
    }

    const raw = (total / dedupedKeywords.length) * 100;
    return Math.min(MATCH_SCORE_MAX_PERCENTAGE, Math.round(raw));
  }

  /**
   * Build the deduplicated keyword set (term + JD-side aliases) consumed by
   * `computeScore`. Static so both the orchestrator and the diff-computation
   * service can share one implementation — duplicating the merge logic across
   * services is exactly how before/after scores drift apart.
   *
   * Dedup is by lowercase term so primary keywords and mandatory skills do
   * not double-count when they overlap.
   */
  static buildKeywordSet(
    jobAnalysis: JobAnalysisResult | null | undefined,
  ): Array<{ term: string; aliases?: string[] }> {
    if (!jobAnalysis) return [];

    const terms = [
      ...(jobAnalysis.keywords?.primary ?? []),
      ...(jobAnalysis.technical?.mandatorySkills ?? []),
    ];

    const jdAliases = KeywordMatchScoringService.readJdAliases(
      jobAnalysis.keywords,
    );

    const seen = new Set<string>();
    const out: Array<{ term: string; aliases?: string[] }> = [];
    for (const raw of terms) {
      if (typeof raw !== 'string') continue;
      const term = raw.trim();
      if (!term) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const aliases = jdAliases.get(key);
      out.push(aliases && aliases.length > 0 ? { term, aliases } : { term });
    }
    return out;
  }

  /**
   * Normalize the JD-side alias payload into a lowercase term-to-aliases map.
   * Reads `keywords.aliases` (canonical, post-Task-2) first and falls back to
   * `keywords.synonyms` (legacy). Tolerates two shapes:
   *  - Canonical array: `Array<{ term: string; alternatives: string[] }>`
   *  - Legacy map:      `Record<string, string[]>`
   *
   * Mirror of the orchestrator's private `readJdAliases` — kept here so
   * `buildKeywordSet` is fully self-contained.
   */
  private static readJdAliases(keywords: unknown): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (!keywords || typeof keywords !== 'object') return map;

    const kw = keywords as { aliases?: unknown; synonyms?: unknown };
    const source = kw.aliases !== undefined ? kw.aliases : kw.synonyms;
    if (!source) return map;

    const pushAliases = (term: unknown, aliases: unknown): void => {
      if (typeof term !== 'string') return;
      const key = term.trim().toLowerCase();
      if (!key) return;
      if (!Array.isArray(aliases)) return;
      const cleaned = aliases
        .filter((a): a is string => typeof a === 'string')
        .map((a) => a.trim())
        .filter((a) => a.length > 0);
      if (cleaned.length === 0) return;
      const existing = map.get(key) ?? [];
      map.set(key, [...existing, ...cleaned]);
    };

    if (Array.isArray(source)) {
      for (const entry of source) {
        if (!entry || typeof entry !== 'object') continue;
        const e = entry as { term?: unknown; alternatives?: unknown };
        pushAliases(e.term, e.alternatives);
      }
    } else if (typeof source === 'object') {
      for (const [term, aliases] of Object.entries(
        source as Record<string, unknown>,
      )) {
        pushAliases(term, aliases);
      }
    }

    return map;
  }

  /**
   * Score a single keyword. Returns a value in [0, 1].
   *
   * Builds candidate phrases from the term + per-keyword aliases + universal
   * alias map, then returns the maximum phrase-level partial-credit score.
   *
   * When `applyAliases` is false, only the literal `term` is scored — both
   * the per-keyword `aliases` and the `UNIVERSAL_ALIAS_MAP` safety net are
   * bypassed. The result is the strict "literal ATS scanner" view used for
   * the `before` score.
   */
  private scoreSingleKeyword(
    keyword: { term: string; aliases?: string[] },
    stemmedResumeTokens: string[],
    stemmedResumeSet: Set<string>,
    applyAliases: boolean,
  ): number {
    const term = keyword.term.trim();
    if (!term) return 0;

    const candidatePhrases: string[] = [term];
    if (applyAliases) {
      const universalKey = term.toLowerCase();
      const universalAliases = UNIVERSAL_ALIAS_MAP[universalKey] ?? [];
      candidatePhrases.push(...(keyword.aliases ?? []), ...universalAliases);
    }

    let best = 0;
    for (const phrase of candidatePhrases) {
      const score = this.scorePhrase(
        phrase,
        stemmedResumeTokens,
        stemmedResumeSet,
      );
      if (score > best) best = score;
      if (best >= 1) break;
    }
    return best;
  }

  /**
   * Score one candidate phrase against the (already stemmed) resume tokens.
   * Returns partial credit in [0, 1] using:
   *   base = matchedTokens / totalTokens
   *   + 0.2 bigram bonus if any 2 adjacent phrase tokens appear adjacent in
   *   the resume token stream (cap at 1.0).
   */
  private scorePhrase(
    phrase: string,
    stemmedResumeTokens: string[],
    stemmedResumeSet: Set<string>,
  ): number {
    const normalized = normalizeText(phrase);
    const phraseTokens = tokenize(normalized);
    if (phraseTokens.length === 0) return 0;

    const stemmedPhraseTokens = stemTokens(phraseTokens);

    let matched = 0;
    for (const token of stemmedPhraseTokens) {
      if (stemmedResumeSet.has(token)) matched += 1;
    }
    let phraseScore = matched / stemmedPhraseTokens.length;

    if (stemmedPhraseTokens.length >= 2) {
      const hasAdjacent = this.hasAdjacentBigram(
        stemmedPhraseTokens,
        stemmedResumeTokens,
      );
      if (hasAdjacent) {
        phraseScore = Math.min(1, phraseScore + 0.2);
      }
    }

    return phraseScore;
  }

  /**
   * True iff any two consecutive phrase tokens appear consecutively (in order)
   * in the resume token stream.
   */
  private hasAdjacentBigram(
    phraseTokens: string[],
    resumeTokens: string[],
  ): boolean {
    if (phraseTokens.length < 2 || resumeTokens.length < 2) return false;
    for (let i = 0; i < phraseTokens.length - 1; i++) {
      const a = phraseTokens[i];
      const b = phraseTokens[i + 1];
      for (let j = 0; j < resumeTokens.length - 1; j++) {
        if (resumeTokens[j] === a && resumeTokens[j + 1] === b) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Flatten a TailoredContent object (or pass-through a raw string) into a
   * single lowercased text blob suitable for normalization + tokenization.
   *
   * Mirrors the previous orchestrator-private `contentToText`: title, summary,
   * all skill categories, every experience (position + responsibilities +
   * achievements + technologies), education (degree + institution) and
   * certifications (name). When candidate-side aliases are supplied, their
   * `alternatives` are appended so the scorer can match against them too.
   */
  private flattenContent(
    content: TailoredContent | string,
    candidateSkillAliases?: Array<{ skill: string; alternatives: string[] }>,
  ): string {
    let base: string;
    if (typeof content === 'string') {
      base = content;
    } else if (!content) {
      base = '';
    } else {
      const parts: string[] = [];
      if (content.title) parts.push(content.title);
      if (content.summary) parts.push(content.summary);

      if (content.skills) {
        const { languages, frameworks, tools, databases, concepts } =
          content.skills;
        parts.push(
          ...(languages ?? []),
          ...(frameworks ?? []),
          ...(tools ?? []),
          ...(databases ?? []),
          ...(concepts ?? []),
        );
      }

      for (const exp of content.experience ?? []) {
        if (exp.position) parts.push(exp.position);
        parts.push(...(exp.responsibilities ?? []));
        parts.push(...(exp.achievements ?? []));
        if (exp.technologies) parts.push(exp.technologies);
      }

      for (const edu of content.education ?? []) {
        if (edu.degree) parts.push(edu.degree);
        if (edu.institution) parts.push(edu.institution);
      }

      for (const cert of content.certifications ?? []) {
        if (cert.name) parts.push(cert.name);
      }

      base = parts.join(' ');
    }

    if (candidateSkillAliases && candidateSkillAliases.length > 0) {
      const aliasBlob = candidateSkillAliases
        .flatMap((entry) => entry.alternatives ?? [])
        .join(' ');
      if (aliasBlob) {
        base = base.length > 0 ? `${base} ${aliasBlob}` : aliasBlob;
      }
    }

    return base.toLowerCase();
  }
}
