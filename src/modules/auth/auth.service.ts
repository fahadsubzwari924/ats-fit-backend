import { User } from './../../database/entities/user.entity';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SignUpDto } from './dtos/sign-up.dto';
import { SignInDto } from './dtos/sign-in.dto';
import { BaseMapperService } from '../../shared/services/base-mapper.service';
import { UserService } from '../user/user.service';
import { IFeatureUsage } from '../../shared/interfaces';
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
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly mapper: BaseMapperService,
  ) {}

  async signUp(signUpDto: SignUpDto): Promise<User> {
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

    return user;
  }

  async signIn(signInDto: SignInDto): Promise<SignInResponse> {
    const { email, password } = signInDto;

    // Step 1: Find and validate user
    const user = await this.findActiveUserByEmail(email);

    // Step 2: Verify credentials
    await this.verifyUserPassword(user, password);

    // Step 3: Generate response data in parallel
    const [featureUsage, access_token] = await Promise.all([
      this.getFeatureUsage(user),
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

  /**
   * Get feature usage for a user using the user service
   * This follows the Single Responsibility Principle by delegating to UserService
   * @param user User entity
   * @returns Formatted feature usage array
   */
  private async getFeatureUsage(user: User): Promise<Array<IFeatureUsage>> {
    return this.userService.getFeatureUsageForUser(user);
  }
}
