import { User } from './../../database/entities/user.entity';
import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
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
      throw new ConflictException('Email already exists');
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

  async signIn(signInDto: SignInDto): Promise<{
    user: User & {
      featureUsage: Array<IFeatureUsage>;
    };
    access_token: string;
  }> {
    const { email, password } = signInDto;

    // Find user
    const user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect(
        'user.uploadedResumes',
        'resumes',
        'resumes.isActive = :isActive',
        { isActive: true },
      )
      .where('user.email = :email', { email })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Fetch feature usage tracking
    const featureUsage = await this.getFeatureUsage(user.id);

    // Generate JWT
    const payload = { sub: user.id, email: user.email };
    const access_token = await this.jwtService.signAsync(payload);

    return {
      user: {
        ...user,
        featureUsage,
      },
      access_token,
    };
  }

  private async getFeatureUsage(userId: string): Promise<Array<IFeatureUsage>> {
    const usageTracking = await this.usageTrackingRepository.find({
      where: { user_id: userId },
    });

    const rateLimitConfigs = await this.rateLimitConfigRepository.find({
      where: { is_active: true },
    });

    const featureLimits = rateLimitConfigs.reduce(
      (acc, config) => {
        acc[config.feature_type] = config.monthly_limit;
        return acc;
      },
      {} as Record<string, number>,
    );

    const featureUsage: Array<IFeatureUsage> = [];

    usageTracking.forEach((track) => {
      const feature = track.feature_type as keyof typeof featureLimits;
      if (featureLimits[feature]) {
        featureUsage.push({
          feature,
          allowed: featureLimits[feature],
          remaining: featureLimits[feature] - track.usage_count,
        });
      }
    });

    return featureUsage;
  }
}
