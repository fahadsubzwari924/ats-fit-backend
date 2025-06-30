// dtos/generate-tailored-resume.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { 
  IsString, 
  IsNotEmpty, 
  MinLength, 
  MaxLength, 
  IsMongoId,
  IsOptional,
  ValidateIf,
  Matches
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class GenerateTailoredResumeDto {
  @ApiProperty({
    description: 'Job description to tailor the resume for',
    example: 'Looking for a senior developer with 5+ years of Node.js experience, React, and AWS. Must have experience with microservices architecture and CI/CD pipelines.',
    minLength: 20,
    maxLength: 10000
  })
  @IsString({ message: 'Job description must be a string' })
  @IsNotEmpty({ message: 'Job description is required' })
  @MinLength(20, { message: 'Job description must contain at least 20 characters' })
  @MaxLength(10000, { message: 'Job description is too long (maximum 10,000 characters)' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  jobDescription: string;

  @ApiProperty({
    description: 'Company name being applied to',
    example: 'Acme Inc',
    minLength: 2,
    maxLength: 100
  })
  @IsString({ message: 'Company name must be a string' })
  @IsNotEmpty({ message: 'Company name is required' })
  @MinLength(2, { message: 'Company name must contain at least 2 characters' })
  @MaxLength(100, { message: 'Company name is too long (maximum 100 characters)' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  companyName: string;

  @ApiProperty({
    description: 'ID of the template to use (MongoDB ObjectId or UUID format)',
    example: '65a1d5f8e6541f2b8c8f9d6e',
    pattern: '^[0-9a-fA-F]{24}$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  })
  @IsString({ message: 'Template ID must be a string' })
  @IsNotEmpty({ message: 'Template ID is required' })
  @Matches(
    /^[0-9a-fA-F]{24}$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    { 
      message: 'Template ID must be a valid MongoDB ObjectId (24 characters) or UUID format' 
    }
  )
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  templateId: string;
}

// File upload validation DTO
export class ResumeFileDto {
  @ApiProperty({
    description: 'Resume file (PDF only)',
    type: 'string',
    format: 'binary',
    example: 'resume.pdf'
  })
  @IsOptional()
  resumeFile?: Express.Multer.File;
}

// Combined DTO for the entire request
export class GenerateResumeRequestDto {
  @ApiProperty({
    description: 'Job description to tailor the resume for',
    example: 'Looking for a senior developer with 5+ years of Node.js experience, React, and AWS. Must have experience with microservices architecture and CI/CD pipelines.',
    minLength: 20,
    maxLength: 10000
  })
  @IsString({ message: 'Job description must be a string' })
  @IsNotEmpty({ message: 'Job description is required' })
  @MinLength(20, { message: 'Job description must contain at least 20 characters' })
  @MaxLength(10000, { message: 'Job description is too long (maximum 10,000 characters)' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  jobDescription: string;

  @ApiProperty({
    description: 'Company name being applied to',
    example: 'Acme Inc',
    minLength: 2,
    maxLength: 100
  })
  @IsString({ message: 'Company name must be a string' })
  @IsNotEmpty({ message: 'Company name is required' })
  @MinLength(2, { message: 'Company name must contain at least 2 characters' })
  @MaxLength(100, { message: 'Company name is too long (maximum 100 characters)' })
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  companyName: string;

  @ApiProperty({
    description: 'ID of the template to use (MongoDB ObjectId or UUID format)',
    example: '65a1d5f8e6541f2b8c8f9d6e',
    pattern: '^[0-9a-fA-F]{24}$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  })
  @IsString({ message: 'Template ID must be a string' })
  @IsNotEmpty({ message: 'Template ID is required' })
  @Matches(
    /^[0-9a-fA-F]{24}$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    { 
      message: 'Template ID must be a valid MongoDB ObjectId (24 characters) or UUID format' 
    }
  )
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  })
  templateId: string;

  @ApiProperty({
    description: 'Resume file (PDF only)',
    type: 'string',
    format: 'binary',
    example: 'resume.pdf'
  })
  @IsOptional()
  resumeFile?: Express.Multer.File;
}
