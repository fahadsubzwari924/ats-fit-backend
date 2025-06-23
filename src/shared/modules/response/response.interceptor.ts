import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ResponseService } from './response.service';
import { Request } from '@nestjs/common';
import { ApiResponseDto } from './response.dto';

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponseDto<T>>
{
  constructor(private readonly responseService: ResponseService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponseDto<T>> {
    const request = context.switchToHttp().getRequest<Request>();

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
