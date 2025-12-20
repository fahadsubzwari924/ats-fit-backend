import { User, RegistrationType } from './../../database/entities/user.entity';
import { Injectable, Res } from '@nestjs/common';
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
import { TokenPayload } from 'google-auth-library';

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

    if (user.registration_type !== RegistrationType.GENERAL) {
      throw new UnauthorizedException(
        'Google registered user, try Google login',
        ERROR_CODES.GOOGLE_LOGIN_USER_TRYING_GOOGLE_AUTH,
      );
    }

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
        'user.registration_type',
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

  /**
   * Google authentication - handles both sign up and sign in
   * Follows Single Responsibility Principle by delegating to specific methods
   *
   * @param googlePayload Token payload from Google OAuth
   * @returns SignInResponse with user data and access token
   */
  async googleAuth(googlePayload: TokenPayload): Promise<SignInResponse> {
    const { email, name, sub: googleId } = googlePayload;

    if (!email) {
      throw new BadRequestException(
        'Email not provided by Google',
        ERROR_CODES.BAD_REQUEST,
      );
    }

    // Step 1: Check if user exists
    const existingUser = await this.findUserByEmail(email);

    let user: User;

    if (!existingUser) {
      // Case 1: New user - create account
      user = await this.createGoogleUser(email, name, googlePayload);
    } else {
      // Case 2 & 3: Existing user - validate registration type
      this.validateGoogleUser(existingUser);
      user = existingUser;
    }

    // Step 2: Load user with relationships for response
    const fullUser = await this.findActiveUserByEmail(user.email);

    // Step 3: Generate response data in parallel
    const [featureUsage, access_token] = await Promise.all([
      this.getFeatureUsage(fullUser),
      this.generateAccessToken(fullUser),
    ]);

    // Step 4: Return clean response
    return {
      user: {
        ...this.sanitizeUserForResponse(fullUser),
        featureUsage,
      },
      access_token,
    };
  }

  /**
   * Find user by email without throwing error
   * @param email User email
   * @returns User entity or null
   */
  private async findUserByEmail(email: string): Promise<User | null> {
    return await this.userRepository.findOne({
      where: { email },
      select: [
        'id',
        'email',
        'full_name',
        'registration_type',
        'oauth_provider_data',
        'is_active',
      ],
    });
  }

  /**
   * Validate that existing user is registered via Google
   * Follows Single Responsibility Principle - only validates Google registration
   *
   * @param user Existing user entity
   * @throws UnauthorizedException if user is not a Google user
   */
  private validateGoogleUser(user: User): void {
    // Case 3: Email exists but not registered via Google
    if (user.registration_type !== RegistrationType.GOOGLE) {
      throw new UnauthorizedException(
        'This email is registered with a different method. Please use your email and password to sign in.',
        ERROR_CODES.UNAUTHORIZED,
      );
    }

    // Additional validation: Check if oauth_provider_data exists
    if (
      !user.oauth_provider_data ||
      Object.keys(user.oauth_provider_data).length === 0
    ) {
      throw new UnauthorizedException(
        'Google authentication data not found. Please contact support.',
        ERROR_CODES.GOOGLE_USER_NOT_AUTHENTICATED,
      );
    }

    // Validate user is active
    if (!user.is_active) {
      throw new UnauthorizedException(
        'Account is inactive. Please contact support.',
        ERROR_CODES.UNAUTHORIZED,
      );
    }
  }

  /**
   * Create new user from Google authentication
   * Follows Single Responsibility Principle - only handles user creation
   *
   * @param email User email from Google
   * @param name User name from Google
   * @param googlePayload Full Google token payload
   * @returns Created user entity
   */
  private async createGoogleUser(
    email: string,
    name: string,
    googlePayload: TokenPayload,
  ): Promise<User> {
    // Generate dummy password (required by database schema)
    const dummyPassword = await this.generateDummyPassword();

    // Create user entity
    const user = this.userRepository.create({
      email,
      full_name: name || googlePayload.given_name, // Use given_name from Google payload if name not provided
      password: dummyPassword,
      registration_type: RegistrationType.GOOGLE,
      oauth_provider_data: googlePayload,
      is_active: true,
    });

    // Save user to database
    return await this.userRepository.save(user);
  }

  /**
   * Generate a secure dummy password for Google users
   * Google users don't use password authentication, but field is required
   *
   * @returns Hashed random password
   */
  private async generateDummyPassword(): Promise<string> {
    const randomPassword = `google_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return await bcrypt.hash(randomPassword, 10);
  }

  /**
   * Load user with all required relationships for response
   * @param userId User ID
   * @returns User entity with relationships
   */
  private async loadUserWithRelationships(userId: string): Promise<User> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.password',
        'user.full_name',
        'user.plan',
        'user.user_type',
        'user.registration_type',
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
      .where('user.id = :userId', { userId })
      .getOne();

    if (!user) {
      throw new UnauthorizedException(
        'User not found',
        ERROR_CODES.USER_NOT_FOUND,
      );
    }

    return user;
  }
}
