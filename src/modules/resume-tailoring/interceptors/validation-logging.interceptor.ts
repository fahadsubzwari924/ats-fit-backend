import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Injectable()
export class ValidationLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ValidationLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(
      catchError(
        (error: {
          message?: string;
          stack?: string;
          status?: number;
          response?: any;
        }) => {
          this.logger.error('Validation or processing error caught:', {
            error: error.message ?? 'Unknown error message',
            stack: error.stack ?? 'No stack trace available',
            status: error.status ?? 500,
            response:
              typeof error.response === 'string'
                ? error.response
                : 'No response available',
            path:
              context.switchToHttp().getRequest<{ url?: string }>()?.url ??
              'Unknown path',
            method:
              context.switchToHttp().getRequest<{ method?: string }>()
                ?.method ?? 'Unknown method',
          });

          return throwError(() => error);
        },
      ),
    );
  }
}
