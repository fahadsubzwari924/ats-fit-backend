import { IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class RedeemBetaCodeDto {
  @IsString({ message: 'Please enter your beta invite code.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase().trim() : value,
  )
  @Matches(/^BETA-[A-Z2-9]{8}$/, {
    message:
      'Invalid code format. Codes look like BETA-XXXXXXXX. Please copy the full code from your invite email.',
  })
  code: string;
}
