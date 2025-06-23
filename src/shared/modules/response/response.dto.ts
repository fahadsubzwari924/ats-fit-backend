import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  IsDateString,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum ResponseStatus {
  SUCCESS = 'success',
  ERROR = 'error',
}

class MetaDto {
  @IsDateString()
  timestamp: string;

  @IsUUID()
  requestId: string;

  @IsString()
  path: string;
}

export class ErrorDetailDto {
  @IsString()
  field: string;

  @IsString()
  message: string;
}

export class ApiResponseDto<T = any> {
  @IsEnum(ResponseStatus)
  status: ResponseStatus;

  @IsString()
  message: string;

  @IsString()
  code: string;

  @IsOptional()
  data?: T;

  @IsOptional()
  @IsArray()
  @Type(() => ErrorDetailDto)
  errors?: ErrorDetailDto[];

  @Type(() => MetaDto)
  meta: MetaDto;
}
