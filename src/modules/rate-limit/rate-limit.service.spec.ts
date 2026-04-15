import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RateLimitService } from './rate-limit.service';
import {
  UsageTracking,
  FeatureType,
} from '../../database/entities/usage-tracking.entity';
import { RateLimitConfig } from '../../database/entities/rate-limit-config.entity';
import { UserPlan, UserType } from '../../database/entities/user.entity';

describe('RateLimitService', () => {
  let service: RateLimitService;

  const mockUsageTrackingRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  };

  const mockRateLimitConfigRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        {
          provide: getRepositoryToken(UsageTracking),
          useValue: mockUsageTrackingRepository,
        },
        {
          provide: getRepositoryToken(RateLimitConfig),
          useValue: mockRateLimitConfigRepository,
        },
      ],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  const freemiumContext = {
    userId: 'user-freemium',
    userType: UserType.REGISTERED,
    plan: UserPlan.FREEMIUM,
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
  };

  const premiumContext = {
    userId: 'user-premium',
    userType: UserType.REGISTERED,
    plan: UserPlan.PREMIUM,
    ipAddress: '127.0.0.1',
    userAgent: 'jest',
  };

  // ---------------------------------------------------------------------------
  // getUserUsageStats()
  // ---------------------------------------------------------------------------

  describe('getUserUsageStats()', () => {
    it('FREEMIUM — returns resume_generation and cover_letter, no resume_batch_generation', async () => {
      // Single batch config fetch returns both FREEMIUM configs
      mockRateLimitConfigRepository.find.mockResolvedValue([
        {
          monthly_limit: 3,
          plan: UserPlan.FREEMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.RESUME_GENERATION,
          is_active: true,
        },
        {
          monthly_limit: 1,
          plan: UserPlan.FREEMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.COVER_LETTER,
          is_active: true,
        },
      ]);
      // No existing usage records
      mockUsageTrackingRepository.find.mockResolvedValue([]);

      const stats = await service.getUserUsageStats(freemiumContext);

      expect(stats).toHaveProperty('resume_generation');
      expect(stats).toHaveProperty('cover_letter');
      expect(stats).not.toHaveProperty('resume_batch_generation');
      expect(stats.resume_generation.limit).toBe(3);
      expect(stats.cover_letter.limit).toBe(1);
    });

    it('PREMIUM — returns resume_generation, cover_letter, and resume_batch_generation', async () => {
      mockRateLimitConfigRepository.find.mockResolvedValue([
        {
          monthly_limit: 30,
          plan: UserPlan.PREMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.RESUME_GENERATION,
          is_active: true,
        },
        {
          monthly_limit: 15,
          plan: UserPlan.PREMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.COVER_LETTER,
          is_active: true,
        },
        {
          monthly_limit: 10,
          plan: UserPlan.PREMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.RESUME_BATCH_GENERATION,
          is_active: true,
        },
      ]);
      mockUsageTrackingRepository.find.mockResolvedValue([]);

      const stats = await service.getUserUsageStats(premiumContext);

      expect(stats).toHaveProperty('resume_generation');
      expect(stats).toHaveProperty('cover_letter');
      expect(stats).toHaveProperty('resume_batch_generation');
      expect(stats.resume_generation.limit).toBe(30);
      expect(stats.cover_letter.limit).toBe(15);
      expect(stats.resume_batch_generation.limit).toBe(10);
    });

    it('reflects existing usage from a single batch usage fetch', async () => {
      mockRateLimitConfigRepository.find.mockResolvedValue([
        {
          monthly_limit: 3,
          plan: UserPlan.FREEMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.RESUME_GENERATION,
          is_active: true,
        },
        {
          monthly_limit: 1,
          plan: UserPlan.FREEMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.COVER_LETTER,
          is_active: true,
        },
      ]);
      // User has already used 2 resume generations
      mockUsageTrackingRepository.find.mockResolvedValue([
        { feature_type: FeatureType.RESUME_GENERATION, usage_count: 2 },
      ]);

      const stats = await service.getUserUsageStats(freemiumContext);

      expect(stats.resume_generation.currentUsage).toBe(2);
      expect(stats.resume_generation.remaining).toBe(1);
      expect(stats.cover_letter.currentUsage).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getFormattedFeatureUsage()
  // ---------------------------------------------------------------------------

  describe('getFormattedFeatureUsage()', () => {
    it('FREEMIUM — returns exactly 2 entries using FeatureType enum values', async () => {
      mockRateLimitConfigRepository.find.mockResolvedValue([
        {
          monthly_limit: 3,
          plan: UserPlan.FREEMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.RESUME_GENERATION,
          is_active: true,
        },
        {
          monthly_limit: 1,
          plan: UserPlan.FREEMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.COVER_LETTER,
          is_active: true,
        },
      ]);
      mockUsageTrackingRepository.find.mockResolvedValue([]);

      const formatted = await service.getFormattedFeatureUsage(freemiumContext);

      expect(formatted).toHaveLength(2);
      expect(formatted[0].feature).toBe(FeatureType.RESUME_GENERATION);
      expect(formatted[1].feature).toBe(FeatureType.COVER_LETTER);
    });

    it('PREMIUM — returns exactly 3 entries using FeatureType enum values', async () => {
      mockRateLimitConfigRepository.find.mockResolvedValue([
        {
          monthly_limit: 30,
          plan: UserPlan.PREMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.RESUME_GENERATION,
          is_active: true,
        },
        {
          monthly_limit: 15,
          plan: UserPlan.PREMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.COVER_LETTER,
          is_active: true,
        },
        {
          monthly_limit: 10,
          plan: UserPlan.PREMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.RESUME_BATCH_GENERATION,
          is_active: true,
        },
      ]);
      mockUsageTrackingRepository.find.mockResolvedValue([]);

      const formatted = await service.getFormattedFeatureUsage(premiumContext);

      expect(formatted).toHaveLength(3);
      expect(formatted[0].feature).toBe(FeatureType.RESUME_GENERATION);
      expect(formatted[1].feature).toBe(FeatureType.COVER_LETTER);
      expect(formatted[2].feature).toBe(FeatureType.RESUME_BATCH_GENERATION);
    });

    it('each entry has the correct shape (allowed, remaining, used, usagePercentage, resetDate)', async () => {
      mockRateLimitConfigRepository.find.mockResolvedValue([
        {
          monthly_limit: 3,
          plan: UserPlan.FREEMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.RESUME_GENERATION,
          is_active: true,
        },
        {
          monthly_limit: 1,
          plan: UserPlan.FREEMIUM,
          user_type: UserType.REGISTERED,
          feature_type: FeatureType.COVER_LETTER,
          is_active: true,
        },
      ]);
      mockUsageTrackingRepository.find.mockResolvedValue([]);

      const [first] = await service.getFormattedFeatureUsage(freemiumContext);

      expect(first).toMatchObject({
        feature: FeatureType.RESUME_GENERATION,
        allowed: 3,
        remaining: 3,
        used: 0,
        usagePercentage: '0%',
        resetDate: expect.any(Date),
      });
    });
  });

  // ---------------------------------------------------------------------------
  // initializeRateLimitConfigs()
  // ---------------------------------------------------------------------------

  describe('initializeRateLimitConfigs()', () => {
    const EXPECTED_CONFIGS = [
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_GENERATION,
        monthly_limit: 3,
      },
      {
        plan: UserPlan.FREEMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.COVER_LETTER,
        monthly_limit: 1,
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_GENERATION,
        monthly_limit: 30,
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.COVER_LETTER,
        monthly_limit: 15,
      },
      {
        plan: UserPlan.PREMIUM,
        user_type: UserType.REGISTERED,
        feature_type: FeatureType.RESUME_BATCH_GENERATION,
        monthly_limit: 10,
      },
    ];

    it('upserts exactly 5 configs', async () => {
      // No existing configs — all will be created
      mockRateLimitConfigRepository.findOne.mockResolvedValue(null);
      mockRateLimitConfigRepository.save.mockResolvedValue({});

      await service.initializeRateLimitConfigs();

      expect(mockRateLimitConfigRepository.findOne).toHaveBeenCalledTimes(5);
      expect(mockRateLimitConfigRepository.save).toHaveBeenCalledTimes(5);
    });

    it('creates each config with the correct plan, feature_type, and monthly_limit', async () => {
      mockRateLimitConfigRepository.findOne.mockResolvedValue(null);
      mockRateLimitConfigRepository.save.mockResolvedValue({});

      await service.initializeRateLimitConfigs();

      const savedArgs = mockRateLimitConfigRepository.save.mock.calls.map(
        (call) => call[0] as Partial<RateLimitConfig>,
      );

      for (const expected of EXPECTED_CONFIGS) {
        const match = savedArgs.find(
          (arg) =>
            arg.plan === expected.plan &&
            arg.feature_type === expected.feature_type,
        );

        expect(match).toBeDefined();
        expect(match.monthly_limit).toBe(expected.monthly_limit);
        expect(match.user_type).toBe(expected.user_type);
      }
    });

    it('does not create a config that already exists', async () => {
      // Simulate all configs already present
      mockRateLimitConfigRepository.findOne.mockResolvedValue({
        id: 'existing',
      });

      await service.initializeRateLimitConfigs();

      expect(mockRateLimitConfigRepository.findOne).toHaveBeenCalledTimes(5);
      expect(mockRateLimitConfigRepository.save).not.toHaveBeenCalled();
    });

    it('does not create FREEMIUM/RESUME_BATCH_GENERATION (blocked at route level)', async () => {
      mockRateLimitConfigRepository.findOne.mockResolvedValue(null);
      mockRateLimitConfigRepository.save.mockResolvedValue({});

      await service.initializeRateLimitConfigs();

      const savedArgs = mockRateLimitConfigRepository.save.mock.calls.map(
        (call) => call[0] as Partial<RateLimitConfig>,
      );

      const freemiumBatch = savedArgs.find(
        (arg) =>
          arg.plan === UserPlan.FREEMIUM &&
          arg.feature_type === FeatureType.RESUME_BATCH_GENERATION,
      );

      expect(freemiumBatch).toBeUndefined();
    });

    it('does not create JOB_APPLICATION_TRACKING configs (unlimited — no rate limit needed)', async () => {
      mockRateLimitConfigRepository.findOne.mockResolvedValue(null);
      mockRateLimitConfigRepository.save.mockResolvedValue({});

      await service.initializeRateLimitConfigs();

      const savedArgs = mockRateLimitConfigRepository.save.mock.calls.map(
        (call) => call[0] as Partial<RateLimitConfig>,
      );

      const jobTrackingConfigs = savedArgs.filter(
        (arg) => arg.feature_type === FeatureType.JOB_APPLICATION_TRACKING,
      );

      expect(jobTrackingConfigs).toHaveLength(0);
    });
  });
});
