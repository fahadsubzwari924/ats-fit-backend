import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ResponseService } from './response.service';
import { Request } from 'express';
import { ApiResponseDto } from './response.dto';

/**
 * Routes whose responses must NOT be wrapped in ApiResponseDto.
 *
 * Server-Sent Events (`@Sse()`) endpoints emit `MessageEvent` objects that
 * NestJS formats directly to the SSE wire (`event:`, `id:`, `data:` lines).
 * Wrapping each emission in `{ status, message, code, data, ... }` would:
 *   1. Strip the `event:` name (browser fires default `message` events instead
 *      of named events the client subscribes to).
 *   2. Cause finite SSE Observables (e.g. terminal-status fast paths returning
 *      a single snapshot) to be treated as a regular response, closing the
 *      stream and triggering EventSource auto-reconnect loops.
 *
 * Match the same SSE allowlist as `JwtStrategy` so this stays in sync.
 */
const NO_WRAP_PATHS: RegExp[] = [/\/batch\/v2\/[^/]+\/events$/];

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponseDto<T> | T
> {
  constructor(private readonly responseService: ResponseService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponseDto<T> | T> {
    const request = context.switchToHttp().getRequest<Request>();
    const path = (request.originalUrl || request.url || '').split('?')[0];

    if (NO_WRAP_PATHS.some((re) => re.test(path))) {
      return next.handle();
    }

    this.responseService.setPath(request.url);

    return next.handle().pipe(
      map((data: T | ApiResponseDto<T>) => {
        // Check if data is already an ApiResponseDto (e.g., from error filter)
        if (this.isApiResponseDto(data)) {
          return data;
        }
        return this.responseService.success(data);
      }),
    );
  }

  private isApiResponseDto(data: unknown): data is ApiResponseDto<T> {
    if (!data || typeof data !== 'object') {
      return false;
    }
    const typedData = data as Record<string, unknown>;
    return (
      'status' in typedData &&
      typeof typedData.status === 'string' &&
      (typedData.status === 'success' || typedData.status === 'error') &&
      'message' in typedData &&
      'code' in typedData &&
      'meta' in typedData
    );
  }
}
