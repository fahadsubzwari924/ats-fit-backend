import { Injectable, Scope } from '@nestjs/common';
import { ApiResponseDto, ErrorDetailDto, ResponseStatus } from './response.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable({ scope: Scope.REQUEST })
export class ResponseService {
  private requestId: string;
  private path: string;

  constructor() {
    this.requestId = uuidv4();
    this.path = '';
  }

  setPath(path: string) {
    this.path = path;
  }

  getRequestId(): string {
    return this.requestId;
  }

  private getMeta(): { timestamp: string; requestId: string; path: string } {
    return {
      timestamp: new Date().toISOString(),
      requestId: this.requestId,
      path: this.path,
    };
  }

  success<T>(
    data: T,
    message = 'Request successful',
    code = '200',
  ): ApiResponseDto<T> {
    return {
      status: ResponseStatus.SUCCESS,
      message,
      code,
      data,
      errors: null,
      meta: this.getMeta(),
    };
  }

  error(
    message: string,
    code: string,
    errors: ErrorDetailDto[] | null = null,
  ): ApiResponseDto<null> {
    return {
      status: ResponseStatus.ERROR,
      message,
      code,
      data: null,
      errors,
      meta: this.getMeta(),
    };
  }
}
