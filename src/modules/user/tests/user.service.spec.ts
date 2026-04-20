import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from '../user.service';
import { User, UserPlan } from '../../../database/entities/user.entity';
import { UserSubscription } from '../../../database/entities/user-subscription.entity';
import { RateLimitService } from '../../rate-limit/rate-limit.service';

const mockUserRepository = () => ({
  findOne: jest.fn(),
  update: jest.fn(),
});

const mockUserSubscriptionRepository = () => ({
  findOne: jest.fn(),
});

const mockRateLimitService = () => ({
  getFormattedFeatureUsage: jest.fn(),
  resetUsageForUser: jest.fn().mockResolvedValue(undefined),
});

describe('UserService', () => {
  let service: UserService;
  let userRepository: ReturnType<typeof mockUserRepository>;
  let rateLimitService: ReturnType<typeof mockRateLimitService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useFactory: mockUserRepository,
        },
        {
          provide: getRepositoryToken(UserSubscription),
          useFactory: mockUserSubscriptionRepository,
        },
        {
          provide: RateLimitService,
          useFactory: mockRateLimitService,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    userRepository = module.get(getRepositoryToken(User));
    rateLimitService = module.get(RateLimitService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('upgradeToPremium', () => {
    it('should update user plan to PREMIUM', async () => {
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.upgradeToPremium('user-uuid-123');

      expect(userRepository.update).toHaveBeenCalledWith('user-uuid-123', {
        plan: UserPlan.PREMIUM,
      });
    });

    it('should call update exactly once', async () => {
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.upgradeToPremium('user-uuid-123');

      expect(userRepository.update).toHaveBeenCalledTimes(1);
    });

    it('should reset usage for the user after upgrading', async () => {
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.upgradeToPremium('user-uuid-123');

      expect(rateLimitService.resetUsageForUser).toHaveBeenCalledWith(
        'user-uuid-123',
      );
      expect(rateLimitService.resetUsageForUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('downgradeToFreemium', () => {
    it('should update user plan to FREEMIUM', async () => {
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.downgradeToFreemium('user-uuid-123');

      expect(userRepository.update).toHaveBeenCalledWith('user-uuid-123', {
        plan: UserPlan.FREEMIUM,
      });
    });

    it('should call update exactly once', async () => {
      userRepository.update.mockResolvedValue({ affected: 1 });

      await service.downgradeToFreemium('user-uuid-123');

      expect(userRepository.update).toHaveBeenCalledTimes(1);
    });
  });
});
