import * as fs from 'fs';
import * as path from 'path';
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
import { AB_EXPERIMENTS } from '../constants/ab-experiments.constants';

const FIXTURES_ROOT = path.join(
  __dirname,
  '__fixtures__',
  'optimizer-golden-set',
);

const listFixtureFiles = (variant: string): string[] => {
  const variantDir = path.join(FIXTURES_ROOT, variant);
  if (!fs.existsSync(variantDir)) return [];
  return fs
    .readdirSync(variantDir)
    .filter((file) => file.endsWith('.json'))
    .sort();
};

const liveVariants = AB_EXPERIMENTS.flatMap((experiment) =>
  experiment.variants.filter((variant) => variant.weight > 0),
);

const darkVariants = AB_EXPERIMENTS.flatMap((experiment) =>
  experiment.variants.filter((variant) => variant.weight === 0),
);

const fixturePairs = AB_EXPERIMENTS.flatMap((experiment) =>
  experiment.variants.flatMap((variant) =>
    listFixtureFiles(variant.name).map((file) => ({
      variant: variant.name,
      file,
    })),
  ),
);

describe('optimizer-golden-set', () => {
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

  describe('coverage gate', () => {
    if (liveVariants.length === 0) {
      it.skip('no live variants to enforce — skipping coverage gate', () =>
        undefined);
    }

    it.each(liveVariants.map((variant) => [variant.name, variant.weight]))(
      'variant %s (weight=%s) has at least one fixture',
      (variantName) => {
        const variantDir = path.join(FIXTURES_ROOT, variantName);
        expect(fs.existsSync(variantDir)).toBe(true);

        const fixtures = listFixtureFiles(variantName);
        expect(fixtures.length).toBeGreaterThan(0);
      },
    );

    for (const dark of darkVariants) {
      console.info(
        `[optimizer-golden-set] variant "${dark.name}" is dark-launched (weight=0) — no fixture required`,
      );
    }
  });

  describe('per-fixture parser pipeline', () => {
    if (fixturePairs.length === 0) {
      it.skip('no fixtures discovered — nothing to parse', () => undefined);
    }

    it.each(fixturePairs.map(({ variant, file }) => [variant, file]))(
      '%s/%s parses cleanly through parseOptimizationResponse',
      (variant, file) => {
        const fixturePath = path.join(FIXTURES_ROOT, variant, file);
        const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as unknown;

        const result = (
          service as unknown as {
            parseOptimizationResponse: (response: unknown) => {
              optimizedContent: {
                title: string;
                experience: unknown[];
              };
              optimizationMetrics: { confidenceScore: number };
            };
          }
        ).parseOptimizationResponse(raw);

        expect(typeof result.optimizedContent.title).toBe('string');
        expect(Array.isArray(result.optimizedContent.experience)).toBe(true);
        expect(typeof result.optimizationMetrics.confidenceScore).toBe(
          'number',
        );
        expect(
          result.optimizationMetrics.confidenceScore,
        ).toBeGreaterThanOrEqual(0);
        expect(result.optimizationMetrics.confidenceScore).toBeLessThanOrEqual(
          100,
        );
      },
    );
  });
});
