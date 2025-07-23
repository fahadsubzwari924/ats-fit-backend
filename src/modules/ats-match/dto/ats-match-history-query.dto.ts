import { Transform } from 'class-transformer';
import { IsOptional, IsArray, IsString } from 'class-validator';

export class AtsMatchHistoryQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: string }) => value.split(','))
  @IsArray()
  @IsString({ each: true })
  fields?: string[];
}
