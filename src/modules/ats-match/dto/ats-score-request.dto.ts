import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class AtsScoreRequestDto {
  @ApiProperty({
    type: 'string',
    description: 'Job description to match against',
    minLength: 20,
    maxLength: 10000,
    example: 'Looking for a senior developer with 5+ years of Node.js experience, React, and AWS. Must have experience with microservices architecture and CI/CD pipelines.'
  })
  @IsString()
  @MinLength(20)
  @MaxLength(10000)
  jobDescription: string;
} 