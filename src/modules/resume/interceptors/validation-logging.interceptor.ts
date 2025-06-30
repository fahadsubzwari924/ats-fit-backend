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
      catchError(error => {
        this.logger.error('Validation or processing error caught:', {
          error: error.message,
          stack: error.stack,
          status: error.status,
          response: error.response,
          path: context.switchToHttp().getRequest().url,
          method: context.switchToHttp().getRequest().method,
        });
        
        return throwError(() => error);
      }),
    );
  }
} 