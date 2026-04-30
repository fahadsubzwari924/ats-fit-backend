import {
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class InviteBetaUsersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((v: string) => v?.toLowerCase().trim())
      : value,
  )
  @IsEmail({}, { each: true })
  emails: string[];

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{1,50}$/)
  cohort?: string;

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(90)
  accessDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  codeValidDays?: number;
}
