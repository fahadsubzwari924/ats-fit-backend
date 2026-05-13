import { IsEmail, IsString, IsNotEmpty, MinLength } from 'class-validator';

export class SignInDto {
  @IsNotEmpty({ message: 'Please enter your email address.' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @IsNotEmpty({ message: 'Please enter your password.' })
  @IsString({ message: 'Password must be text.' })
  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  password: string;
}
