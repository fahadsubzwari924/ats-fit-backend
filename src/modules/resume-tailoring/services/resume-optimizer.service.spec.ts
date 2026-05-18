import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ResumeOptimizerService } from './resume-optimizer.service';
import { ClaudeService } from '../../../shared/modules/external/services/claude.service';
import { OpenAIService } from '../../../shared/modules/external/services/open_ai.service';
import { PromptService } from '../../../shared/services/prompt.service';
import { CacheService } from '../../../shared/services/cache.service';
import { BulletRelevanceScoringService } from './bullet-relevance-scoring.service';
import { ExperienceTechAllowlistService } from './experience-tech-allowlist.service';
import { PromptVariantResolverService } from './prompt-variant-resolver.service';
import {
  BadRequestException,
  CustomHttpException,
  InternalServerErrorException,
} from '../../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../../shared/constants/error-codes';

const buildValidOptimizedContent = () => ({
  title: 'Data Engineer',
  contactInfo: {
    name: 'X',
    email: 'x@y.com',
    phone: '',
    location: '',
    linkedin: '',
    portfolio: '',
    github: '',
  },
  summary: 'Summary',
  skills: {
    languages: [],
    frameworks: [],
    tools: [],
    databases: [],
    concepts: [],
  },
  experience: [],
  education: [],
  certifications: [],
  additionalSections: [],
});

const buildValidOptimizationMetrics = () => ({
  keywordsAdded: 0,
  sectionsOptimized: 0,
  achievementsQuantified: 0,
  skillsAligned: 0,
  confidenceScore: 50,
});

const wrapClaudeResponse = (payload: unknown) => ({
  choices: [{ message: { content: JSON.stringify(payload) } }],
});

const wrapOpenAIResponse = (payload: unknown) => ({
  choices: [{ message: { content: JSON.stringify(payload) } }],
});

describe('ResumeOptimizerService', () => {
  let service: ResumeOptimizerService;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResumeOptimizerService,
        { provide: ClaudeService, useValue: {} },
        { provide: OpenAIService, useValue: {} },
        { provide: PromptService, useValue: {} },
        { provide: CacheService, useValue: {} },
        { provide: BulletRelevanceScoringService, useValue: {} },
        { provide: ExperienceTechAllowlistService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: PromptVariantResolverService, useValue: {} },
      ],
    }).compile();

    service = module.get<ResumeOptimizerService>(ResumeOptimizerService);

    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  const invokeClaudeParser = (response: unknown) =>
    (service as any).parseOptimizationResponse(response);

  const invokeOpenAIParser = (response: unknown) =>
    (service as any).parseOpenAIOptimizationResponse(response);

  const invokeIsRetryable = (error: unknown): boolean =>
    (service as any).isRetryableOptimizerError(error);

  describe('parseOptimizationResponse', () => {
    it('returns parsed object on happy path with nested fields and logs no warn', () => {
      const response = wrapClaudeResponse({
        optimizedContent: buildValidOptimizedContent(),
        optimizationMetrics: buildValidOptimizationMetrics(),
      });

      const result = invokeClaudeParser(response);

      expect(result.optimizedContent.title).toBe('Data Engineer');
      expect(result.optimizationMetrics.confidenceScore).toBe(50);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('coerces stringified optimizedContent (the prod failure mode) and logs warn with claude source', () => {
      const malformedClaudeResponse = wrapClaudeResponse({
        optimizedContent: JSON.stringify(buildValidOptimizedContent()),
        optimizationMetrics: buildValidOptimizationMetrics(),
      });

      const result = invokeClaudeParser(malformedClaudeResponse);

      expect(result.optimizedContent.title).toBe('Data Engineer');
      expect(result.optimizationMetrics.confidenceScore).toBe(50);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('hallucinated_stringified_payload', {
        source: 'claude',
        field: 'optimizedContent',
      });
    });

    it('coerces stringified optimizationMetrics and logs warn with claude source', () => {
      const response = wrapClaudeResponse({
        optimizedContent: buildValidOptimizedContent(),
        optimizationMetrics: JSON.stringify(buildValidOptimizationMetrics()),
      });

      const result = invokeClaudeParser(response);

      expect(result.optimizationMetrics.confidenceScore).toBe(50);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('hallucinated_stringified_payload', {
        source: 'claude',
        field: 'optimizationMetrics',
      });
    });

    it('coerces both stringified fields and logs one warn per field', () => {
      const response = wrapClaudeResponse({
        optimizedContent: JSON.stringify(buildValidOptimizedContent()),
        optimizationMetrics: JSON.stringify(buildValidOptimizationMetrics()),
      });

      const result = invokeClaudeParser(response);

      expect(result.optimizedContent.title).toBe('Data Engineer');
      expect(result.optimizationMetrics.confidenceScore).toBe(50);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith('hallucinated_stringified_payload', {
        source: 'claude',
        field: 'optimizedContent',
      });
      expect(warnSpy).toHaveBeenCalledWith('hallucinated_stringified_payload', {
        source: 'claude',
        field: 'optimizationMetrics',
      });
    });

    it('leaves field untouched when stringified value is not valid JSON and validator throws MISSING_REQUIRED_AI_FIELD', () => {
      const response = wrapClaudeResponse({
        optimizedContent: 'not-valid-json{',
        optimizationMetrics: buildValidOptimizationMetrics(),
      });

      let caught: unknown;
      try {
        invokeClaudeParser(response);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(InternalServerErrorException);
      const errorBody = (caught as CustomHttpException).getResponse() as {
        errorCode?: string;
      };
      expect(errorBody.errorCode).toBe(ERROR_CODES.MISSING_REQUIRED_AI_FIELD);
    });
  });

  describe('parseOpenAIOptimizationResponse', () => {
    it('returns parsed object on happy path with nested fields and logs no warn', () => {
      const response = wrapOpenAIResponse({
        optimizedContent: buildValidOptimizedContent(),
        optimizationMetrics: buildValidOptimizationMetrics(),
      });

      const result = invokeOpenAIParser(response);

      expect(result.optimizedContent.title).toBe('Data Engineer');
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('coerces stringified optimizedContent and logs warn with openai source', () => {
      const response = wrapOpenAIResponse({
        optimizedContent: JSON.stringify(buildValidOptimizedContent()),
        optimizationMetrics: buildValidOptimizationMetrics(),
      });

      const result = invokeOpenAIParser(response);

      expect(result.optimizedContent.title).toBe('Data Engineer');
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith('hallucinated_stringified_payload', {
        source: 'openai',
        field: 'optimizedContent',
      });
    });
  });

  describe('isRetryableOptimizerError', () => {
    it('returns true for MISSING_REQUIRED_AI_FIELD', () => {
      const err = new InternalServerErrorException(
        'missing',
        ERROR_CODES.MISSING_REQUIRED_AI_FIELD,
      );
      expect(invokeIsRetryable(err)).toBe(true);
    });

    it('returns true for AI_OUTPUT_TRUNCATED (regression guard)', () => {
      const err = new InternalServerErrorException(
        'truncated',
        ERROR_CODES.AI_OUTPUT_TRUNCATED,
      );
      expect(invokeIsRetryable(err)).toBe(true);
    });

    it('returns true for AI_RESPONSE_PARSING_FAILED (regression guard)', () => {
      const err = new InternalServerErrorException(
        'parse failed',
        ERROR_CODES.AI_RESPONSE_PARSING_FAILED,
      );
      expect(invokeIsRetryable(err)).toBe(true);
    });

    it('returns false for an unrelated error code', () => {
      const err = new BadRequestException(
        'invalid metric',
        ERROR_CODES.INVALID_METRIC_FIELD,
      );
      expect(invokeIsRetryable(err)).toBe(false);
    });

    it('returns false for a non-CustomHttpException', () => {
      expect(invokeIsRetryable(new Error('boom'))).toBe(false);
    });
  });
});
