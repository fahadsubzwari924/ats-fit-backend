import {
  IsEnum,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
  IsInt,
  Min,
  IsEmail,
} from 'class-validator';
import { InterviewStage } from '../enums/interview-stage.enum';
import { InterviewFormat } from '../enums/interview-format.enum';
import { InterviewOutcome } from '../enums/interview-outcome.enum';

export class CreateJobApplicationInterviewDto {
  @IsEnum(InterviewStage)
  stage: InterviewStage;

  @IsOptional()
  @IsEnum(InterviewFormat)
  format?: InterviewFormat;

  @IsOptional()
  @IsEnum(InterviewOutcome)
  outcome?: InterviewOutcome;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;

  @IsOptional()
  @IsDateString()
  completed_at?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration_minutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  interviewer_name?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  interviewer_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  location_or_link?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

export class UpdateJobApplicationInterviewDto {
  @IsOptional()
  @IsEnum(InterviewStage)
  stage?: InterviewStage;

  @IsOptional()
  @IsEnum(InterviewFormat)
  format?: InterviewFormat;

  @IsOptional()
  @IsEnum(InterviewOutcome)
  outcome?: InterviewOutcome;

  @IsOptional()
  @IsDateString()
  scheduled_at?: string;

  @IsOptional()
  @IsDateString()
  completed_at?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration_minutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  interviewer_name?: string;

  @IsOptional()
  @IsString()
  @IsEmail()
  interviewer_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  location_or_link?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
