import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsOptional,
  Matches,
} from 'class-validator';
import { TrimString } from '../../../shared/utils/transformers';

export class GenerateTailoredResumeDto {
  @IsString({ message: 'Job description must be a string' })
  @IsNotEmpty({ message: 'Job description is required' })
  @MinLength(20, {
    message: 'Job description must contain at least 20 characters',
  })
  @MaxLength(10000, {
    message: 'Job description is too long (maximum 10,000 characters)',
  })
  @TrimString()
  jobDescription: string;

  @IsString({ message: 'Company name must be a string' })
  @IsNotEmpty({ message: 'Company name is required' })
  @MinLength(2, { message: 'Company name must contain at least 2 characters' })
  @MaxLength(100, {
    message: 'Company name is too long (maximum 100 characters)',
  })
  @TrimString()
  companyName: string;

  @IsString({ message: 'Template ID must be a string' })
  @IsNotEmpty({ message: 'Template ID is required' })
  @Matches(
    /^[0-9a-fA-F]{24}$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    {
      message:
        'Template ID must be a valid MongoDB ObjectId (24 characters) or UUID format',
    },
  )
  @TrimString()
  templateId: string;
}

// File upload validation DTO
export class ResumeFileDto {
  @IsOptional()
  resumeFile?: Express.Multer.File;
}

// Combined DTO for the entire request
export class GenerateResumeRequestDto {
  @IsString({ message: 'Job description must be a string' })
  @IsNotEmpty({ message: 'Job description is required' })
  @MinLength(20, {
    message: 'Job description must contain at least 20 characters',
  })
  @MaxLength(10000, {
    message: 'Job description is too long (maximum 10,000 characters)',
  })
  @TrimString()
  jobDescription: string;

  @IsString({ message: 'Company name must be a string' })
  @IsNotEmpty({ message: 'Company name is required' })
  @MinLength(2, { message: 'Company name must contain at least 2 characters' })
  @MaxLength(100, {
    message: 'Company name is too long (maximum 100 characters)',
  })
  @TrimString()
  companyName: string;

  @IsString({ message: 'Template ID must be a string' })
  @IsNotEmpty({ message: 'Template ID is required' })
  @Matches(
    /^[0-9a-fA-F]{24}$|^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    {
      message:
        'Template ID must be a valid MongoDB ObjectId (24 characters) or UUID format',
    },
  )
  @TrimString()
  templateId: string;

  @IsOptional()
  resumeFile?: Express.Multer.File;
}
