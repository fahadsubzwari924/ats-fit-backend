import { User } from './../../database/entities/user.entity';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignUpDto } from './dtos/sign-up.dto';
import { SignInDto } from './dtos/sign-in.dto';
import { BaseMapperService } from '../../shared/services/base-mapper.service';
import { UsageTracking } from '../../database/entities/usage-tracking.entity';
import { RateLimitConfig } from '../../database/entities/rate-limit-config.entity';
import { IFeatureUsage } from 'src/shared/interfaces';
import {
  BadRequestException,
  UnauthorizedException,
} from '../../shared/exceptions/custom-http-exceptions';
import { ERROR_CODES } from '../../shared/constants/error-codes';
import { SignInResponse } from './types/sign-in-response.types';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UsageTracking)
    private readonly usageTrackingRepository: Repository<UsageTracking>,
    @InjectRepository(RateLimitConfig)
    private readonly rateLimitConfigRepository: Repository<RateLimitConfig>,
    private readonly jwtService: JwtService,
    private readonly mapper: BaseMapperService,
  ) {}

  async signUp(
    signUpDto: SignUpDto,
  ): Promise<{ user: User; access_token: string }> {
    const { email, password } = signUpDto;

    // Check if email already exists
    const existingUser = await this.userRepository.findOne({
      where: { email },
    });
    if (existingUser) {
      throw new BadRequestException(
        'Email already exists',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create and save user
    const user = this.mapper.toEntity(User, signUpDto, {
      password: hashedPassword,
    });
    await this.userRepository.save(user);

    // Generate JWT
    const payload = { sub: user.id, email: user.email };
    const access_token = await this.jwtService.signAsync(payload);

    return { user, access_token };
  }

  async signIn(signInDto: SignInDto): Promise<SignInResponse> {
    const { email, password } = signInDto;

    // Step 1: Find and validate user
    const user = await this.findActiveUserByEmail(email);

    // Step 2: Verify credentials
    await this.verifyUserPassword(user, password);

    // Step 3: Generate response data in parallel
    const [featureUsage, access_token] = await Promise.all([
      this.getFeatureUsage(user.id),
      this.generateAccessToken(user),
    ]);

    // Step 4: Return clean response (exclude password)
    return {
      user: {
        ...this.sanitizeUserForResponse(user),
        featureUsage,
      },
      access_token,
    };
  }

  private async generateAccessToken(user: User): Promise<string> {
    const payload = { sub: user.id, email: user.email };
    return this.jwtService.signAsync(payload);
  }

  /**
   * Find active user by email with optimized query
   * @param email User email
   * @returns User entity with uploaded resumes
   */
  private async findActiveUserByEmail(email: string): Promise<User> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.password',
        'user.full_name',
        'user.plan',
        'user.user_type',
        'user.is_active',
        'user.created_at',
        'user.updated_at',
      ])
      .leftJoinAndSelect(
        'user.uploadedResumes',
        'resumes',
        'resumes.isActive = :isActive',
        { isActive: true },
      )
      .where('user.email = :email AND user.is_active = :active', {
        email,
        active: true,
      })
      .cache(30000) // Cache user data for 30 seconds
      .getOne();

    if (!user) {
      throw new UnauthorizedException(
        'Invalid credentials',
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    return user;
  }

  /**
   * Verify user password against hashed password
   * @param user User entity
   * @param password Plain text password
   */
  private async verifyUserPassword(
    user: User,
    password: string,
  ): Promise<void> {
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException(
        'Invalid credentials',
        ERROR_CODES.UNAUTHORIZED,
      );
    }
  }

  /**
   * Remove sensitive data from user object before sending response
   * @param user User entity
   * @returns Sanitized user object
   */
  private sanitizeUserForResponse(user: User): Omit<User, 'password'> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...sanitizedUser } = user;
    return sanitizedUser;
  }

  private async getFeatureUsage(userId: string): Promise<Array<IFeatureUsage>> {
    // Optimize: Parallel execution of both database queries
    const [usageTracking, rateLimitConfigs] = await Promise.all([
      this.usageTrackingRepository.find({
        where: { user_id: userId },
        select: ['feature_type', 'usage_count'], // Select only necessary fields
      }),
      this.rateLimitConfigRepository.find({
        where: { is_active: true },
        select: ['feature_type', 'monthly_limit'], // Select only necessary fields
        cache: 300000, // Cache for 5 minutes since rate limits don't change often
      }),
    ]);

    // Optimize: Create a Map for O(1) lookup instead of array operations
    const featureLimitsMap = new Map<string, number>();
    rateLimitConfigs.forEach((config) => {
      featureLimitsMap.set(config.feature_type, config.monthly_limit);
    });

    const featureUsage: Array<IFeatureUsage> = [];

    usageTracking.forEach((track) => {
      const allowedUsage = featureLimitsMap.get(track.feature_type);
      if (allowedUsage !== undefined) {
        featureUsage.push({
          feature: track.feature_type,
          allowed: allowedUsage,
          remaining: Math.max(0, allowedUsage - track.usage_count), // Ensure non-negative
        });
      }
    });

    return featureUsage;
  }
}
