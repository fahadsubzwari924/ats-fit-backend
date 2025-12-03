import { User } from './../../database/entities/user.entity';
import { Controller, Post, Body, ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignUpDto } from './dtos/sign-up.dto';
import { SignInDto } from './dtos/sign-in.dto';
import { Public } from './decorators/public.decorator';
import { SignInResponse } from './types/sign-in-response.types';
import { UnauthorizedException } from '../../shared/exceptions/custom-http-exceptions';
import { GoogleService } from '../../shared/modules/external/services/google.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly googleService: GoogleService,
  ) {}

  @Public()
  @Post('signup')
  async signUp(@Body(ValidationPipe) signUpDto: SignUpDto): Promise<User> {
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

    // Step 1: Verify Google token and get payload
    const googlePayload = await this.googleService.login(token);

    // Step 2: Handle authentication (sign up or sign in)
    return await this.authService.googleAuth(googlePayload);
  }

  @Public()
  @Post('google/webhook')
  async googleWebhook(
    @Body() payload: any,
  ): Promise<void> {
    console.log('Google Sign-In Webhook called with data:', payload)
  }

}
