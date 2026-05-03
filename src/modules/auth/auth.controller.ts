import {
  Controller,
  Post,
  Body,
  ValidationPipe,
  Get,
  Query,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { PasswordResetService } from './services/password-reset.service';
import { SignUpDto } from './dtos/sign-up.dto';
import { SignInDto } from './dtos/sign-in.dto';
import { ForgotPasswordDto } from './dtos/forgot-password.dto';
import { ResetPasswordDto } from './dtos/reset-password.dto';
import { Public } from './decorators/public.decorator';
import { SignInResponse } from './types/sign-in-response.types';
import { UnauthorizedException } from '../../shared/exceptions/custom-http-exceptions';
import { GoogleService } from '../../shared/modules/external/services/google.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleService: GoogleService,
    private readonly passwordResetService: PasswordResetService,
  ) {}

  @Public()
  @Post('signup')
  async signUp(
    @Body(ValidationPipe) signUpDto: SignUpDto,
  ): Promise<SignInResponse> {
    return this.authService.signUp(signUpDto);
  }

  @Public()
  @Post('signin')
  async signIn(
    @Body(ValidationPipe) signInDto: SignInDto,
  ): Promise<SignInResponse> {
    return this.authService.signIn(signInDto);
  }

  @Public()
  @Post('google/login')
  async googleAuthLogin(@Body('token') token: string): Promise<SignInResponse> {
    if (!token) {
      throw new UnauthorizedException('Google token is missing');
    }
    const googlePayload = await this.googleService.login(token);
    return await this.authService.googleAuth(googlePayload);
  }

  @Public()
  @Post('google/webhook')
  googleWebhook(@Body() payload: unknown): void {
    console.log('Google Sign-In Webhook called with data:', payload);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body(ValidationPipe) dto: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.ip;
    await this.passwordResetService.requestPasswordReset(dto.email, clientIp);
    return {
      message: 'If that email is registered, a reset link has been sent.',
    };
  }

  @Public()
  @Get('reset-password/validate')
  async validateResetToken(
    @Query('token') token: string,
  ): Promise<{ valid: boolean; emailHint?: string; reason?: string }> {
    if (!token) {
      return { valid: false, reason: 'not_found' };
    }
    return await this.passwordResetService.validateResetToken(token);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(ValidationPipe) dto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    await this.passwordResetService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password reset successfully.' };
  }
}
