import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class BaseMapperService {
  toEntity<T>(
    entityClass: new () => T,
    dto: Partial<T>,
    overrides: Partial<T> = {},
  ): T {
    return plainToInstance(entityClass, {
      ...dto,
      ...overrides,
    });
  }
}
