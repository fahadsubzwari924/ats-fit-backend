import { Injectable } from '@nestjs/common';
import { TailoredContent } from '../interfaces/resume-extracted-keywords.interface';

/**
 * Build per-experience tech allowlists and detect technology hallucinations
 * in optimized resume bullets.
 *
 * Why this exists:
 *   The LLM was substituting technologies in work experience bullets to match
 *   the job description (e.g. swapping "Angular" for "React" in a Finlex role
 *   the candidate actually did in Angular). This service is the deterministic
 *   guardrail that the prompt-side fence is paired with — it operates on the
 *   structured output and reverts any bullet that introduces a JD-driven tech
 *   token not present in that specific experience.
 */
@Injectable()
export class ExperienceTechAllowlistService {
  /**
   * Build an allowed-tech set per experience (lowercase tokens).
   *
   * Sources, in priority order:
   *   1. The experience's own `technologies` field (comma-split).
   *   2. Any candidate-wide skill token that appears verbatim inside that
   *      experience's responsibility bullets — promoted into the allowlist.
   *
   * JD-only tokens are intentionally excluded from the allowlist — that
   * exclusion is what makes the fence enforceable downstream.
   */
  buildAllowlist(content: TailoredContent): Array<Set<string>> {
    const candidateSkillTokens = this.collectCandidateSkills(content);

    return (content.experience ?? []).map((exp) => {
      const allowlist = new Set<string>();

      this.splitTokens(exp.technologies).forEach((t) => allowlist.add(t));

      const bulletsText = (exp.responsibilities ?? []).join(' ').toLowerCase();
      candidateSkillTokens.forEach((skill) => {
        if (this.containsTokenWord(bulletsText, skill)) {
          allowlist.add(skill);
        }
      });

      return allowlist;
    });
  }

  /**
   * Build the vocabulary used to decide whether an unexpected token in an
   * optimized bullet should count as a technology hallucination. Prose words
   * are ignored — only tokens in this vocabulary are flagged.
   *
   * Vocabulary = candidate-wide skill tokens ∪ JD tech tokens.
   */
  buildTechVocabulary(
    content: TailoredContent,
    jdTokens: string[],
  ): Set<string> {
    const vocab = new Set<string>();
    this.collectCandidateSkills(content).forEach((t) => vocab.add(t));
    (jdTokens ?? []).forEach((raw) => {
      const t = this.normalize(raw);
      if (t) vocab.add(t);
    });
    return vocab;
  }

  /**
   * Return tech tokens introduced by the LLM into the optimized bullet that:
   *   - are not in the experience's allowlist,
   *   - are not in the original source bullet,
   *   - are in the tech vocabulary (so prose words are ignored).
   *
   * An empty array means the bullet is safe to keep.
   */
  detectForbiddenTokens(
    outputBullet: string,
    sourceBullet: string,
    allowlist: Set<string>,
    techVocabulary: Set<string>,
  ): string[] {
    const outputLower = (outputBullet ?? '').toLowerCase();
    const sourceLower = (sourceBullet ?? '').toLowerCase();
    const offenders: string[] = [];

    techVocabulary.forEach((token) => {
      if (!token) return;
      if (allowlist.has(token)) return;
      if (this.containsTokenWord(sourceLower, token)) return;
      if (this.containsTokenWord(outputLower, token)) offenders.push(token);
    });

    return offenders;
  }

  private collectCandidateSkills(content: TailoredContent): Set<string> {
    const skills = content.skills ?? ({} as TailoredContent['skills']);
    const all = [
      ...(skills.languages ?? []),
      ...(skills.frameworks ?? []),
      ...(skills.tools ?? []),
      ...(skills.databases ?? []),
      ...(skills.concepts ?? []),
    ];
    return new Set(all.map((s) => this.normalize(s)).filter(Boolean));
  }

  private splitTokens(raw?: string): string[] {
    if (!raw) return [];
    return raw
      .split(/[,;|/]/)
      .map((part) => this.normalize(part))
      .filter(Boolean);
  }

  private normalize(value: string): string {
    return (value ?? '').trim().toLowerCase();
  }

  /**
   * True when `text` contains `token` as a standalone token (boundary-aware).
   * Escapes regex metacharacters so tokens like `node.js` and `c++` work.
   */
  private containsTokenWord(text: string, token: string): boolean {
    if (!text || !token) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9.+#-])${escaped}([^a-z0-9.+#-]|$)`, 'i');
    return re.test(text);
  }
}
