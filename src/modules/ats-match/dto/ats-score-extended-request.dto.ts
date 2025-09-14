import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class AtsScoreExtendedRequestDto {
  @ApiProperty({
    type: 'string',
    description: 'Job description to match against',
    minLength: 20,
    maxLength: 10000,
    example:
      'Looking for a senior developer with 5+ years of Node.js experience, React, and AWS. Must have experience with microservices architecture and CI/CD pipelines.',
  })
  @IsString()
  @MinLength(20)
  @MaxLength(10000)
  jobDescription: string;

  @ApiProperty({
    type: 'string',
    description: 'Optional company name for the job',
    example: 'Tech Corp',
    required: false,
  })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiProperty({
    type: 'string',
    description: 'Optional resume content of the applicant',
    example:
      'Experienced developer with a strong background in building scalable web applications.',
    required: false,
  })
  @IsOptional()
  @IsString()
  resumeContent?: string;

  @ApiProperty({
    type: 'string',
    description:
      'ID of the pre-uploaded resume to use for ATS scoring. Only available for registered users (freemium/premium). If provided, resume file upload is not required.',
    example: 'e4d5f6g7-h8i9-j0k1-l2m3-n4o5p6q7r8s9',
    required: false,
  })
  @IsOptional()
  @IsUUID(4, { message: 'Resume ID must be a valid UUID' })
  resumeId?: string;

  @ApiProperty({
    type: 'boolean',
    description:
      'Whether to use the most recently uploaded resume. Only available for registered users. If true and multiple resumes exist, the most recent one will be used.',
    example: false,
    required: false,
    default: false,
  })
  @IsOptional()
  useLatestResume?: boolean;
}
