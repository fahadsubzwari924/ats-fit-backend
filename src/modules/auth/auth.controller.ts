import { User } from './../../database/entities/user.entity';
import { Controller, Post, Body, ValidationPipe } from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignUpDto } from './dtos/sign-up.dto';
import { SignInDto } from './dtos/sign-in.dto';
import { Public } from './decorators/public.decorator';
import { SignInResponse } from './types/sign-in-response.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
