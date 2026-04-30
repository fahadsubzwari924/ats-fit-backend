import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { BetaInviteStatus } from '../../../database/entities/beta-invite.entity';

export class AdminListQueryDto {
  @IsOptional()
  @IsString()
  cohort?: string;

  @IsOptional()
  @IsEnum(BetaInviteStatus)
  status?: BetaInviteStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
