import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AnalyzeResumeDto {
  @ApiProperty({
    description: 'Job description to analyze the resume against',
    example:
      'We are looking for a Senior Software Engineer with 5+ years of experience in React, Node.js, and TypeScript...',
    minLength: 20,
    maxLength: 10000,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(20, {
    message: 'Job description must be at least 20 characters long',
  })
  @MaxLength(10000, {
    message: 'Job description cannot exceed 10,000 characters',
  })
  jobDescription: string;
}
