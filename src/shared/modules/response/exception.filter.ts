import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { Response, Request } from 'express';
import { ERROR_CODES, ErrorCode } from '../../../shared/constants/error-codes';
import { ErrorDetailDto } from './response.dto';
import { ResponseService } from './response.service';

// Interface for CustomHttpException response
interface CustomExceptionResponse {
  message: string;
  errorCode: ErrorCode;
  errors?: ErrorDetailDto[] | ValidationError[];
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly responseService: ResponseService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    this.responseService.setPath(request.url);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code: ErrorCode = ERROR_CODES.INTERNAL_SERVER;
    let errors: ErrorDetailDto[] | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (this.isCustomExceptionResponse(exceptionResponse)) {
        // Handle CustomHttpException format
        message = exceptionResponse.message;
        code = exceptionResponse.errorCode;
        errors = this.formatErrors(exceptionResponse.errors) || null;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        // Handle other HttpExceptions with object response
        const typedResponse = exceptionResponse as Record<string, unknown>;
        message = this.getMessage(typedResponse, exception.message);
        code = status.toString() as ErrorCode;

        // Handle validation errors from class-validator
        if ('errors' in typedResponse && Array.isArray(typedResponse.errors)) {
          if (this.isValidationErrorArray(typedResponse.errors)) {
            errors = this.formatValidationErrors(typedResponse.errors);
          }
        }
      } else {
        // Handle string response or fallback
        message =
          typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exception.message;
        code = status.toString() as ErrorCode;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    const errorResponse = this.responseService.error(message, code, errors);
    response.status(status).json(errorResponse);
  }

  private isCustomExceptionResponse(
    response: unknown,
  ): response is CustomExceptionResponse {
    if (typeof response !== 'object' || response === null) {
      return false;
    }
    const typedResponse = response as Record<string, unknown>;
    return (
      'message' in typedResponse &&
      typeof typedResponse.message === 'string' &&
      'errorCode' in typedResponse &&
      typeof typedResponse.errorCode === 'string'
    );
  }

  private getMessage(
    response: Record<string, unknown>,
    fallback: string,
  ): string {
    if ('message' in response) {
      const message = response.message;
      if (typeof message === 'string') {
        return message;
      }
      if (typeof message === 'number' || typeof message === 'boolean') {
        return message.toString();
      }
      // Avoid unsafe stringification for objects or other types
      return fallback;
    }
    return fallback;
  }

  private formatErrors(
    errors: ErrorDetailDto[] | ValidationError[] | undefined,
  ): ErrorDetailDto[] | null {
    if (!errors) {
      return null;
    }
    if (this.isValidationErrorArray(errors)) {
      return this.formatValidationErrors(errors);
    }
    return errors;
  }

  private formatValidationErrors(errors: ValidationError[]): ErrorDetailDto[] {
    return errors.flatMap((error) =>
      Object.values(error.constraints || {}).map((message) => ({
        field: error.property,
        message,
      })),
    );
  }

  private isValidationErrorArray(errors: unknown): errors is ValidationError[] {
    return (
      Array.isArray(errors) &&
      errors.every(
        (error) =>
          typeof error === 'object' &&
          error !== null &&
          'property' in error &&
          'constraints' in error,
      )
    );
  }
}
