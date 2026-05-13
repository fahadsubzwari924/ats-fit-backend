import { IsEmail, IsString, IsNotEmpty, MinLength } from 'class-validator';

export class SignUpDto {
  @IsNotEmpty({ message: 'Please enter your email address.' })
  @IsEmail({}, { message: 'Please enter a valid email address.' })
  email: string;

  @IsNotEmpty({ message: 'Please enter your full name.' })
  @IsString({ message: 'Full name must be text.' })
  @MinLength(2, { message: 'Full name must be at least 2 characters.' })
  full_name: string;

  @IsNotEmpty({ message: 'Please enter a password.' })
  @IsString({ message: 'Password must be text.' })
  @MinLength(8, { message: 'Password must be at least 8 characters long.' })
  password: string;
}
