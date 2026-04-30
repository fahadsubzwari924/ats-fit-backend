import { IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class RedeemBetaCodeDto {
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase().trim() : value,
  )
  @Matches(/^BETA-[A-Z2-9]{8}$/)
  code: string;
}
