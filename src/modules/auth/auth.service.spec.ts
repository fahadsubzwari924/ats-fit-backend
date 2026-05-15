import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import {
  RegistrationType,
  User,
  UserPlan,
  UserType,
} from '../../database/entities/user.entity';
import {
  BetaInvite,
  BetaInviteStatus,
} from '../../database/entities/beta-invite.entity';
import { BaseMapperService } from '../../shared/services/base-mapper.service';
import { UserService } from '../user/user.service';
import { UserMeResponseDto } from '../user/dtos/user-me-response.dto';

const mockUserRepository = () => ({
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockBetaInviteRepository = () => ({
  findOne: jest.fn(),
});

const mockUserService = () => ({
  getCurrentUser: jest.fn(),
});

const mockJwtService = () => ({
  signAsync: jest.fn().mockResolvedValue('signed-jwt-token'),
});

const mockMapper = () => ({
  toEntity: jest.fn((_cls, dto, overrides) => ({ ...dto, ...overrides })),
});

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const PAST = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

const buildPersistedUser = (overrides: Partial<User> = {}): User => {
  return {
    id: 'user-uuid-123',
    full_name: 'Test User',
    email: 'test@example.com',
    password: 'hashed-password',
    plan: UserPlan.FREEMIUM,
    user_type: UserType.REGISTERED,
    registration_type: RegistrationType.GENERAL,
    oauth_provider_data: null as any,
    ip_address: null as any,
    user_agent: null as any,
    is_active: true,
    onboarding_completed: false,
    is_beta_user: false,
    beta_access_until: null,
    founding_rate_locked: false,
    created_at: new Date(),
    updated_at: new Date(),
    resumes: [],
    uploadedResumes: [],
    subscriptions: [],
    passwordResetTokens: [],
    ...overrides,
  } as User;
};

const buildMeResponse = (
  overrides: Partial<UserMeResponseDto> = {},
): UserMeResponseDto => ({
  id: 'user-uuid-123',
  full_name: 'Test User',
  email: 'test@example.com',
  plan: UserPlan.FREEMIUM,
  isPremium: false,
  user_type: UserType.REGISTERED,
  is_active: true,
  onboarding_completed: false,
  created_at: new Date(),
  updated_at: new Date(),
  featureUsage: [],
  uploadedResumes: [],
  ...overrides,
});

describe('AuthService', () => {
  let service: AuthService;
  let userRepository: ReturnType<typeof mockUserRepository>;
  let betaInviteRepository: ReturnType<typeof mockBetaInviteRepository>;
  let userService: ReturnType<typeof mockUserService>;
  let jwtService: ReturnType<typeof mockJwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useFactory: mockUserRepository },
        {
          provide: getRepositoryToken(BetaInvite),
          useFactory: mockBetaInviteRepository,
        },
        { provide: UserService, useFactory: mockUserService },
        { provide: JwtService, useFactory: mockJwtService },
        { provide: BaseMapperService, useFactory: mockMapper },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    userRepository = module.get(getRepositoryToken(User));
    betaInviteRepository = module.get(getRepositoryToken(BetaInvite));
    userService = module.get(UserService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signIn', () => {
    const signInDto = { email: 'test@example.com', password: 'plain-password' };

    const stubFindActiveUserByEmail = (user: User): void => {
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(user),
      };
      userRepository.createQueryBuilder.mockReturnValue(qb);
    };

    beforeEach(() => {
      jest
        .spyOn(bcrypt, 'compare')
        .mockImplementation((() => Promise.resolve(true)) as never);
    });

    it('returns the user payload from UserService.getCurrentUser and an access token', async () => {
      const persisted = buildPersistedUser();
      stubFindActiveUserByEmail(persisted);
      const meResponse = buildMeResponse();
      userService.getCurrentUser.mockResolvedValue(meResponse);

      const result = await service.signIn(signInDto);

      expect(userService.getCurrentUser).toHaveBeenCalledWith(persisted.id);
      expect(result).toEqual({
        user: meResponse,
        access_token: 'signed-jwt-token',
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: persisted.id,
        email: persisted.email,
      });
    });

    it('returns premium plan and premium feature usage for an active beta user', async () => {
      const persisted = buildPersistedUser({
        is_beta_user: true,
        beta_access_until: FUTURE,
      });
      stubFindActiveUserByEmail(persisted);

      const premiumMe = buildMeResponse({
        plan: UserPlan.PREMIUM,
        isPremium: true,
        featureUsage: [
          {
            feature: 'resume_generation',
            allowed: 999,
            used: 0,
            remaining: 999,
            usagePercentage: '0%',
            resetDate: FUTURE,
          } as any,
        ],
      });
      userService.getCurrentUser.mockResolvedValue(premiumMe);

      const result = await service.signIn(signInDto);

      expect(result.user.plan).toBe(UserPlan.PREMIUM);
      expect(result.user.isPremium).toBe(true);
      expect(result.user.featureUsage[0].allowed).toBe(999);
    });

    it('returns freemium plan when the beta access window has expired', async () => {
      const persisted = buildPersistedUser({
        is_beta_user: true,
        beta_access_until: PAST,
      });
      stubFindActiveUserByEmail(persisted);

      const freemiumMe = buildMeResponse({
        plan: UserPlan.FREEMIUM,
        isPremium: false,
      });
      userService.getCurrentUser.mockResolvedValue(freemiumMe);

      const result = await service.signIn(signInDto);

      expect(result.user.plan).toBe(UserPlan.FREEMIUM);
      expect(result.user.isPremium).toBe(false);
    });

    it('returns freemium for a vanilla freemium user', async () => {
      const persisted = buildPersistedUser();
      stubFindActiveUserByEmail(persisted);
      userService.getCurrentUser.mockResolvedValue(buildMeResponse());

      const result = await service.signIn(signInDto);

      expect(result.user.plan).toBe(UserPlan.FREEMIUM);
      expect(result.user.isPremium).toBe(false);
    });

    it('returns premium for a regular paid premium user', async () => {
      const persisted = buildPersistedUser({ plan: UserPlan.PREMIUM });
      stubFindActiveUserByEmail(persisted);
      userService.getCurrentUser.mockResolvedValue(
        buildMeResponse({ plan: UserPlan.PREMIUM, isPremium: true }),
      );

      const result = await service.signIn(signInDto);

      expect(result.user.plan).toBe(UserPlan.PREMIUM);
      expect(result.user.isPremium).toBe(true);
    });

    it('does not include the password field on the response user', async () => {
      const persisted = buildPersistedUser();
      stubFindActiveUserByEmail(persisted);
      userService.getCurrentUser.mockResolvedValue(buildMeResponse());

      const result = await service.signIn(signInDto);

      expect(
        (result.user as unknown as Record<string, unknown>).password,
      ).toBeUndefined();
    });
  });

  describe('signUp', () => {
    const signUpDto = {
      email: 'new@example.com',
      password: 'plain-password',
      full_name: 'New User',
    } as any;

    const stubFindActiveUserByEmail = (user: User): void => {
      const qb: any = {
        select: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(user),
      };
      userRepository.createQueryBuilder.mockReturnValue(qb);
    };

    beforeEach(() => {
      jest
        .spyOn(bcrypt, 'hash')
        .mockImplementation((() => Promise.resolve('hashed-pw')) as never);
      userRepository.findOne.mockResolvedValue(null);
      userRepository.save.mockImplementation(async (u: User) => u);
      betaInviteRepository.findOne.mockResolvedValue(null);
    });

    it('routes the response through UserService.getCurrentUser after applyBetaFlagIfInvited', async () => {
      const callOrder: string[] = [];

      const persisted = buildPersistedUser({
        id: 'new-user-id',
        email: 'new@example.com',
      });
      userRepository.save.mockImplementationOnce(async (u: User) => {
        callOrder.push('save-user');
        u.id = persisted.id;
        return u;
      });

      // Pending beta invite triggers applyBetaFlagIfInvited to flip is_beta_user.
      betaInviteRepository.findOne.mockImplementationOnce(async () => {
        callOrder.push('beta-invite-lookup');
        return {
          id: 'invite-1',
          email: 'new@example.com',
          status: BetaInviteStatus.PENDING,
        } as BetaInvite;
      });
      // Second save (from applyBetaFlagIfInvited) records the order.
      userRepository.save.mockImplementationOnce(async (u: User) => {
        callOrder.push('save-beta-flag');
        return u;
      });

      stubFindActiveUserByEmail(persisted);

      userService.getCurrentUser.mockImplementation(async () => {
        callOrder.push('get-current-user');
        return buildMeResponse({
          id: 'new-user-id',
          email: 'new@example.com',
        });
      });

      const result = await service.signUp(signUpDto);

      expect(callOrder).toEqual([
        'save-user',
        'beta-invite-lookup',
        'save-beta-flag',
        'get-current-user',
      ]);
      expect(userService.getCurrentUser).toHaveBeenCalledWith('new-user-id');
      expect(result.user.id).toBe('new-user-id');
      expect(result.access_token).toBe('signed-jwt-token');
    });
  });
});
