import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService } from '../modules/external/services/claude.service';
import {
  PremiumAtsEvaluation,
  StandardAtsEvaluation,
} from '../../modules/ats-match/interfaces';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AtsMatchHistory } from '../../database/entities/ats-match-history.entity';
import {
  BadRequestException,
  InternalServerErrorException,
} from '../exceptions/custom-http-exceptions';

interface CacheEntry {
  result: PremiumAtsEvaluation;
  timestamp: number;
  ttl: number;
}

// Define interfaces for the injected dependencies to avoid 'any' types
interface IPromptService {
  getPremiumAtsEvaluationPrompt(
    resumeText: string,
    jobDescription: string,
  ): string;
}

interface IAIService {
  evaluateResumeWithAtsCriteria(
    resumeText: string,
    jobDescription: string,
  ): Promise<StandardAtsEvaluation>;
}

/**
 * Shared ATS Evaluation Service
 *
 * This service contains the core ATS scoring logic that was previously in AtsMatchService.
 * It's moved to shared to avoid circular dependencies and allow reuse across modules.
 *
 * Follows SOLID principles:
 * - Single Responsibility: Only handles ATS scoring logic
 * - Open/Closed: Extensible for new evaluation methods
 * - Dependency Inversion: Depends on abstractions (interfaces) not concretions
 */
@Injectable()
export class AtsEvaluationService {
  private readonly logger = new Logger(AtsEvaluationService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtl = 30 * 60 * 1000; // 30 minutes
  private readonly maxCacheSize = 1000; // Maximum cache entries

  constructor(
    private readonly claudeService: ClaudeService,

    @InjectRepository(AtsMatchHistory)
    private readonly atsMatchHistoryRepository: Repository<AtsMatchHistory>,
  ) {
    // Clean up cache every 5 minutes
    setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
  }

  /**
   * Core ATS evaluation method
   * This is the same logic that was used in the ATS match endpoint
   */
  async performAtsEvaluation(
    jobDescription: string,
    resumeText: string,
    promptService: IPromptService,
    aiService?: IAIService,
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

    try {
      if (!jobDescription || !resumeText) {
        throw new BadRequestException(
          'Job description and resume text are required',
        );
      }

      // 1. Generate cache key
      const cacheKey = this.generateCacheKey(jobDescription, resumeText);

      // 2. Check cache first
      const cachedResult = this.getFromCache(cacheKey);
      if (cachedResult) {
        this.logger.log(
          `Cache hit! Returning cached ATS score in ${Date.now() - startTime}ms`,
        );

        // Even with cached results, we need to save a new ATS match history record
        const atsMatchHistory = {
          user_id: userContext?.userId || null,
          guest_id: userContext?.guestId || null,
          ats_score: cachedResult.overallScore,
          company_name: additionalData?.companyName || '',
          job_description: jobDescription,
          resume_content: additionalData?.resumeContent || '',
          analysis: JSON.stringify(cachedResult.detailedBreakdown),
        };

        const createdAtsHistoryRecord =
          await this.saveAtsMatchHistory(atsMatchHistory);
        return {
          evaluation: cachedResult,
          atsMatchHistoryId: createdAtsHistoryRecord.id,
        };
      }

      // 3. Perform premium LLM-based ATS evaluation with timeout
      const atsEvaluation = await this.performPremiumAtsEvaluationWithTimeout(
        resumeText,
        jobDescription,
        promptService,
        aiService,
      );

      // 4. Cache the result
      this.setCache(cacheKey, atsEvaluation);

      // 5. Save ATS match history and get the ID
      const atsMatchHistory = {
        user_id: userContext?.userId || null,
        guest_id: userContext?.guestId || null,
        ats_score: atsEvaluation.overallScore,
        company_name: additionalData?.companyName || '',
        job_description: jobDescription,
        resume_content: additionalData?.resumeContent || '',
        analysis: JSON.stringify(atsEvaluation.detailedBreakdown),
      };

      const createdAtsHistoryRecord =
        await this.saveAtsMatchHistory(atsMatchHistory);

      this.logger.log(`ATS score calculated in ${Date.now() - startTime}ms`);

      return {
        evaluation: atsEvaluation,
        atsMatchHistoryId: createdAtsHistoryRecord.id,
      };
    } catch (error) {
      this.logger.error(
        `Failed to calculate ATS score after ${Date.now() - startTime}ms`,
        error,
      );
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Failed to calculate ATS score');
    }
  }

  private generateCacheKey(jobDescription: string, resumeText: string): string {
    // Create a hash of job description and resume text for caching
    const jobHash = this.simpleHash(jobDescription);
    const resumeHash = this.simpleHash(resumeText);
    return `ats_${jobHash}_${resumeHash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
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
    // Implement LRU cache eviction
    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value as string;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      ttl: this.cacheTtl,
    });
  }

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
      }
    }
  }

  private async performPremiumAtsEvaluationWithTimeout(
    resumeText: string,
    jobDescription: string,
    promptService: IPromptService,
    aiService?: IAIService,
  ): Promise<PremiumAtsEvaluation> {
    const timeout = 30000; // 30 seconds timeout

    try {
      // Create a promise that rejects after timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('ATS evaluation timeout')), timeout);
      });

      // Race between the evaluation and timeout
      const evaluation = await Promise.race([
        this.performPremiumAtsEvaluation(
          resumeText,
          jobDescription,
          promptService,
          aiService,
        ),
        timeoutPromise,
      ]);

      return evaluation;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'ATS evaluation timeout'
      ) {
        this.logger.warn('ATS evaluation timed out, using fallback');
        return this.performFastFallbackEvaluation(resumeText, jobDescription);
      }
      throw error;
    }
  }

  private performFastFallbackEvaluation(
    resumeText: string,
    jobDescription: string,
  ): PremiumAtsEvaluation {
    // Quick keyword-based scoring as fallback
    const keywordScore = this.calculateKeywordScore(resumeText, jobDescription);
    const experienceScore = this.calculateExperienceScore(
      resumeText,
      jobDescription,
    );
    const achievementScore = this.calculateAchievementScore(resumeText);

    const overallScore = Math.round(
      (keywordScore + experienceScore + achievementScore) / 3,
    );

    return {
      overallScore,
      technicalSkillsScore: keywordScore,
      experienceAlignmentScore: experienceScore,
      achievementsScore: achievementScore,
      softSkillsScore: 75,
      resumeQualityScore: 85,
      detailedBreakdown: {
        technicalSkills: {
          matched: [],
          missing: [],
          score: keywordScore,
          reasoning: 'Fast fallback evaluation',
        },
        experience: {
          level: 'Unknown',
          years: 0,
          relevance: experienceScore,
          reasoning: 'Fast fallback evaluation',
        },
        achievements: {
          count: 0,
          quality: achievementScore,
          impact: achievementScore,
          reasoning: 'Fast fallback evaluation',
        },
        softSkills: {
          matched: [],
          missing: [],
          score: 75,
          reasoning: 'Fast fallback evaluation',
        },
        redFlags: [],
        strengths: ['Fast evaluation completed'],
        weaknesses: ['Limited analysis due to timeout'],
        recommendations: ['Consider retrying for full analysis'],
      },
      confidence: 40, // Lower confidence for fallback
    };
  }

  private calculateKeywordScore(
    resumeText: string,
    jobDescription: string,
  ): number {
    const resumeLower = resumeText.toLowerCase();
    const jobLower = jobDescription.toLowerCase();

    // Extract common tech keywords
    const techKeywords: string[] = [
      'node.js',
      'javascript',
      'python',
      'java',
      'react',
      'angular',
      'vue',
      'mongodb',
      'postgresql',
      'mysql',
      'redis',
      'aws',
      'docker',
      'kubernetes',
      'git',
      'jenkins',
      'ci/cd',
      'microservices',
      'api',
      'rest',
      'graphql',
    ];

    let matches = 0;
    for (const keyword of techKeywords) {
      if (jobLower.includes(keyword) && resumeLower.includes(keyword)) {
        matches++;
      }
    }

    return Math.min((matches / techKeywords.length) * 100, 100);
  }

  private calculateExperienceScore(
    resumeText: string,
    jobDescription: string,
  ): number {
    const resumeLower = resumeText.toLowerCase();
    const jobLower = jobDescription.toLowerCase();

    // Check for experience indicators
    const experienceKeywords: string[] = [
      'years',
      'experience',
      'senior',
      'lead',
      'manager',
    ];
    const jobLevelKeywords: string[] = [
      'senior',
      'lead',
      'principal',
      'architect',
    ];

    let score = 0;

    // Check for experience level match
    const jobLevel = jobLevelKeywords.find((keyword) =>
      jobLower.includes(keyword),
    );
    if (jobLevel && resumeLower.includes(jobLevel)) {
      score += 40;
    }

    // Check for years of experience
    const yearPattern = /(\d+)\+?\s*years?/gi;
    const resumeYears = [...resumeLower.matchAll(yearPattern)];
    if (resumeYears.length > 0) {
      const years = parseInt(resumeYears[0][1]);
      if (years >= 5) score += 30;
      else if (years >= 3) score += 20;
      else if (years >= 1) score += 10;
    }

    // Check for experience-related keywords in resume
    const experienceMatches = experienceKeywords.filter((keyword) =>
      resumeLower.includes(keyword),
    );
    if (experienceMatches.length > 0) {
      score += Math.min(experienceMatches.length * 5, 20); // Max 20 points for experience keywords
    }

    return Math.min(score, 100);
  }

  private calculateAchievementScore(resumeText: string): number {
    const resumeLower = resumeText.toLowerCase();

    // Count quantifiable achievements
    const achievementPatterns: RegExp[] = [
      /(\d+%|\$\d+|\d+\s*(users|clients|projects|teams))/gi,
      /improved|increased|reduced|optimized|enhanced/gi,
    ];

    let achievements = 0;
    for (const pattern of achievementPatterns) {
      achievements += [...resumeLower.matchAll(pattern)].length;
    }

    return Math.min(achievements * 10, 100);
  }

  private async performPremiumAtsEvaluation(
    resumeText: string,
    jobDescription: string,
    promptService: IPromptService,
    aiService?: IAIService,
  ): Promise<PremiumAtsEvaluation> {
    const prompt = promptService.getPremiumAtsEvaluationPrompt(
      resumeText,
      jobDescription,
    );

    try {
      const evaluation = (await this.claudeService.evaluateAtsMatch({
        resumeText,
        jobDescription,
        prompt,
      })) as PremiumAtsEvaluation;

      // Validate the evaluation
      this.validatePremiumAtsEvaluation(evaluation);

      this.logger.log(`Premium ATS Evaluation completed with Claude 3.5 Sonnet:
        - Overall Score: ${evaluation.overallScore}%
        - Technical Skills: ${evaluation.technicalSkillsScore}%
        - Experience Alignment: ${evaluation.experienceAlignmentScore}%
        - Achievements: ${evaluation.achievementsScore}%
        - Soft Skills: ${evaluation.softSkillsScore}%
        - Resume Quality: ${evaluation.resumeQualityScore}%
        - Confidence: ${evaluation.confidence}%
      `);

      return evaluation;
    } catch (error) {
      this.logger.error(
        'Claude ATS evaluation failed, falling back to standard evaluation',
        error,
      );

      // Fallback to standard evaluation if aiService is provided
      if (aiService) {
        const standardEvaluation =
          await aiService.evaluateResumeWithAtsCriteria(
            resumeText,
            jobDescription,
          );
        return this.convertStandardToPremiumEvaluation(standardEvaluation);
      }

      // Ultimate fallback
      return this.performFastFallbackEvaluation(resumeText, jobDescription);
    }
  }

  private validatePremiumAtsEvaluation(evaluation: PremiumAtsEvaluation): void {
    const requiredFields: (keyof PremiumAtsEvaluation)[] = [
      'overallScore',
      'technicalSkillsScore',
      'experienceAlignmentScore',
      'achievementsScore',
      'softSkillsScore',
      'resumeQualityScore',
      'confidence',
    ];

    for (const field of requiredFields) {
      if (
        typeof evaluation[field] !== 'number' ||
        evaluation[field] < 0 ||
        evaluation[field] > 100
      ) {
        throw new Error(
          `Invalid ${field} score: must be a number between 0-100`,
        );
      }
    }

    if (!evaluation.detailedBreakdown) {
      throw new Error('Missing detailedBreakdown in evaluation');
    }
  }

  private convertStandardToPremiumEvaluation(
    standardEvaluation: StandardAtsEvaluation,
  ): PremiumAtsEvaluation {
    const llmScore = this.extractLlmScore(standardEvaluation);

    return {
      overallScore: Math.round(llmScore * 100),
      technicalSkillsScore: 75, // Default fallback
      experienceAlignmentScore: 80, // Default fallback
      achievementsScore: 70, // Default fallback
      softSkillsScore: 75, // Default fallback
      resumeQualityScore: 85, // Default fallback
      detailedBreakdown: {
        technicalSkills: {
          matched: [],
          missing: [],
          score: 75,
          reasoning: 'Fallback evaluation',
        },
        experience: {
          level: 'Unknown',
          years: 0,
          relevance: 80,
          reasoning: 'Fallback evaluation',
        },
        achievements: {
          count: 0,
          quality: 70,
          impact: 70,
          reasoning: 'Fallback evaluation',
        },
        softSkills: {
          matched: [],
          missing: [],
          score: 75,
          reasoning: 'Fallback evaluation',
        },
        redFlags: standardEvaluation.redFlags || [],
        strengths: standardEvaluation.strengths || [],
        weaknesses: standardEvaluation.weaknesses || [],
        recommendations: standardEvaluation.recommendations || [],
      },
      confidence: 60, // Lower confidence for fallback
    };
  }

  private extractLlmScore(atsEvaluation: StandardAtsEvaluation): number {
    try {
      if (
        atsEvaluation.overallScore !== undefined &&
        typeof atsEvaluation.overallScore === 'number' &&
        atsEvaluation.overallScore >= 0 &&
        atsEvaluation.overallScore <= 100
      ) {
        return atsEvaluation.overallScore / 100;
      }

      // Fallback calculation
      let score = 0;
      let totalPossibleScore = 0;

      if (atsEvaluation.requiredSectionsPresent) {
        score += 20;
        totalPossibleScore += 20;
      }

      const contactInfo = atsEvaluation.contactInfo;
      const contactScore =
        (((contactInfo.emailPresent ? 1 : 0) +
          (contactInfo.phonePresent ? 1 : 0) +
          (contactInfo.linkedinPresent ? 1 : 0)) /
          3) *
        10;
      score += contactScore;
      totalPossibleScore += 10;

      const achievements = atsEvaluation.quantifiableAchievements;
      const achievementScore = Math.min(
        ((achievements.count || 0) / 5) * 25,
        25,
      );
      score += achievementScore;
      totalPossibleScore += 25;

      const softSkillsMatch = atsEvaluation.softSkillsMatch;
      const softSkillsScore = Math.min((softSkillsMatch.length / 3) * 15, 15);
      score += softSkillsScore;
      totalPossibleScore += 15;

      const redFlags = atsEvaluation.redFlags;
      const redFlagPenalty = Math.min(redFlags.length * 5, 20);
      score -= redFlagPenalty;

      const seniorityMatch = atsEvaluation.seniorityMatch;
      if (
        seniorityMatch.toLowerCase().includes('match') ||
        seniorityMatch.toLowerCase().includes('appropriate') ||
        seniorityMatch.toLowerCase().includes('suitable')
      ) {
        score += 10;
        totalPossibleScore += 10;
      }

      // Use totalPossibleScore for more accurate normalization
      const normalizedScore =
        totalPossibleScore > 0 ? score / totalPossibleScore : 0;
      return Math.max(0, Math.min(1, normalizedScore));
    } catch (error) {
      this.logger.warn('Failed to extract LLM score, using fallback', error);
      return 0.5;
    }
  }

  async saveAtsMatchHistory(
    atsMatchResponsePayload: Partial<AtsMatchHistory>,
  ): Promise<AtsMatchHistory> {
    const atsMatchHistory = this.atsMatchHistoryRepository.create(
      atsMatchResponsePayload,
    );
    const savedRecord =
      await this.atsMatchHistoryRepository.save(atsMatchHistory);
    return savedRecord;
  }
}
