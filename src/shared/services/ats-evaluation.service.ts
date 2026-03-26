import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService } from '../modules/external/services/claude.service';
import { PremiumAtsEvaluation } from '../../modules/ats-match/interfaces';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AtsMatchHistory } from '../../database/entities/ats-match-history.entity';
import { BadRequestException } from '../exceptions/custom-http-exceptions';

interface CacheEntry {
  result: PremiumAtsEvaluation;
  timestamp: number;
  ttl: number;
}

interface IPromptService {
  getPremiumAtsEvaluationPrompt(
    resumeText: string,
    jobDescription: string,
  ): string;
}

/**
 * ATS Evaluation Service
 *
 * Evaluates resume-to-job-description match using Claude.
 * Runs in the background after PDF generation — the user already has their
 * PDF by the time this runs, so failures are logged but never surface to the user.
 *
 * Design decisions:
 * - Claude only: no keyword-based fallback (produces misleading low scores)
 * - No OpenAI fallback: score accuracy matters more than always having a number
 * - On failure: log the error, skip DB save — no score is better than a wrong score
 */
@Injectable()
export class AtsEvaluationService {
  private readonly logger = new Logger(AtsEvaluationService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtl = 30 * 60 * 1000; // 30 minutes
  private readonly maxCacheSize = 1000;
  private readonly evaluationTimeoutMs = 90_000; // 90s — generous, runs in background

  constructor(
    private readonly claudeService: ClaudeService,

    @InjectRepository(AtsMatchHistory)
    private readonly atsMatchHistoryRepository: Repository<AtsMatchHistory>,
  ) {
    setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
  }

  /**
   * Evaluate ATS match for a tailored resume.
   * Called in the background — throws on failure so the caller's .catch() can log it.
   */
  async performAtsEvaluation(
    jobDescription: string,
    resumeText: string,
    promptService: IPromptService,
    _aiService?: unknown,
    userContext?: { userId?: string; guestId?: string },
    additionalData?: {
      companyName?: string;
      resumeContent?: string;
    },
  ): Promise<{
    evaluation: PremiumAtsEvaluation;
    atsMatchHistoryId?: string;
  }> {
    const startTime = Date.now();

    if (!jobDescription || !resumeText) {
      throw new BadRequestException(
        'Job description and resume text are required',
      );
    }

    const cacheKey = this.generateCacheKey(jobDescription, resumeText);
    const cachedResult = this.getFromCache(cacheKey);

    if (cachedResult) {
      this.logger.log(
        `ATS cache hit in ${Date.now() - startTime}ms`,
      );
      const saved = await this.saveAtsMatchHistory({
        user_id: userContext?.userId || null,
        guest_id: userContext?.guestId || null,
        ats_score: cachedResult.overallScore,
        company_name: additionalData?.companyName || '',
        job_description: jobDescription,
        resume_content: additionalData?.resumeContent || '',
        analysis: JSON.stringify(cachedResult.detailedBreakdown),
      });
      return { evaluation: cachedResult, atsMatchHistoryId: saved.id };
    }

    const evaluation = await this.evaluateWithClaude(
      resumeText,
      jobDescription,
      promptService,
    );

    this.setCache(cacheKey, evaluation);

    const saved = await this.saveAtsMatchHistory({
      user_id: userContext?.userId || null,
      guest_id: userContext?.guestId || null,
      ats_score: evaluation.overallScore,
      company_name: additionalData?.companyName || '',
      job_description: jobDescription,
      resume_content: additionalData?.resumeContent || '',
      analysis: JSON.stringify(evaluation.detailedBreakdown),
    });

    this.logger.log(`ATS score calculated in ${Date.now() - startTime}ms`);

    return { evaluation, atsMatchHistoryId: saved.id };
  }

  private async evaluateWithClaude(
    resumeText: string,
    jobDescription: string,
    promptService: IPromptService,
  ): Promise<PremiumAtsEvaluation> {
    const prompt = promptService.getPremiumAtsEvaluationPrompt(
      resumeText,
      jobDescription,
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('ATS evaluation timeout')),
        this.evaluationTimeoutMs,
      ),
    );

    const evaluation = (await Promise.race([
      this.claudeService.evaluateAtsMatch({ resumeText, jobDescription, prompt }),
      timeoutPromise,
    ])) as PremiumAtsEvaluation;

    this.validateEvaluation(evaluation);

    this.logger.log(
      `Premium ATS Evaluation completed successfully:\n` +
        `  Overall: ${evaluation.overallScore}%  Technical: ${evaluation.technicalSkillsScore}%  ` +
        `Experience: ${evaluation.experienceAlignmentScore}%  Achievements: ${evaluation.achievementsScore}%  ` +
        `Soft Skills: ${evaluation.softSkillsScore}%  Quality: ${evaluation.resumeQualityScore}%  ` +
        `Confidence: ${evaluation.confidence}%`,
    );

    return evaluation;
  }

  private validateEvaluation(evaluation: PremiumAtsEvaluation): void {
    const fields: (keyof PremiumAtsEvaluation)[] = [
      'overallScore',
      'technicalSkillsScore',
      'experienceAlignmentScore',
      'achievementsScore',
      'softSkillsScore',
      'resumeQualityScore',
      'confidence',
    ];

    for (const field of fields) {
      if (
        typeof evaluation[field] !== 'number' ||
        (evaluation[field] as number) < 0 ||
        (evaluation[field] as number) > 100
      ) {
        throw new Error(`Invalid ATS field ${field}: must be 0-100`);
      }
    }

    if (!evaluation.detailedBreakdown) {
      throw new Error('Missing detailedBreakdown in ATS evaluation response');
    }
  }

  async saveAtsMatchHistory(
    payload: Partial<AtsMatchHistory>,
  ): Promise<AtsMatchHistory> {
    const record = this.atsMatchHistoryRepository.create(payload);
    return this.atsMatchHistoryRepository.save(record);
  }

  private generateCacheKey(jobDescription: string, resumeText: string): string {
    return `ats_${this.simpleHash(jobDescription)}_${this.simpleHash(resumeText)}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private getFromCache(key: string): PremiumAtsEvaluation | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  private setCache(key: string, result: PremiumAtsEvaluation): void {
    if (this.cache.size >= this.maxCacheSize) {
      const oldest = this.cache.keys().next().value as string;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { result, timestamp: Date.now(), ttl: this.cacheTtl });
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }
}
