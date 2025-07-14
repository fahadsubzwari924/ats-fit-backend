import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorDetailDto } from '../modules/response/response.dto';
import { ERROR_CODES, ErrorCode } from '../constants/error-codes';

// Base interface for custom exception data
interface CustomExceptionData<TDetails = Record<string, unknown>> {
  message: string;
  errorCode: string;
  errors?: ErrorDetailDto[];
  details?: TDetails | null;
}

// Base custom exception class
export class CustomHttpException<
  TDetails = Record<string, unknown>,
> extends HttpException {
  constructor(data: CustomExceptionData<TDetails>, status: HttpStatus) {
    super(
      {
        message: data.message,
        errorCode: data.errorCode,
        errors: data.errors || null,
        details: data.details ?? null,
      },
      status,
    );
  }
}

// Not Found Exception (HTTP 404)
export class NotFoundException<
  TDetails = Record<string, unknown>,
> extends CustomHttpException<TDetails> {
  constructor(
    message = 'Resource not found',
    errorCode: ErrorCode = ERROR_CODES.NOT_FOUND,
    errors?: ErrorDetailDto[],
    details?: TDetails | null,
  ) {
    super({ message, errorCode, errors, details }, HttpStatus.NOT_FOUND);
  }
}

// Bad Request Exception (HTTP 400)
export class BadRequestException<
  TDetails = Record<string, unknown>,
> extends CustomHttpException<TDetails> {
  constructor(
    message = 'Invalid input',
    errorCode: ErrorCode = ERROR_CODES.BAD_REQUEST,
    errors?: ErrorDetailDto[],
    details?: TDetails | null,
  ) {
    super({ message, errorCode, errors, details }, HttpStatus.BAD_REQUEST);
  }
}

// Unauthorized Exception (HTTP 401)
export class UnauthorizedException<
  TDetails = Record<string, unknown>,
> extends CustomHttpException<TDetails> {
  constructor(
    message = 'Unauthorized access',
    errorCode: ErrorCode = ERROR_CODES.UNAUTHORIZED,
    errors?: ErrorDetailDto[],
    details?: TDetails | null,
  ) {
    super({ message, errorCode, errors, details }, HttpStatus.UNAUTHORIZED);
  }
}

// Forbidden Exception (HTTP 403)
export class ForbiddenException<
  TDetails = Record<string, unknown>,
> extends CustomHttpException<TDetails> {
  constructor(
    message = 'Access forbidden',
    errorCode: ErrorCode = ERROR_CODES.FORBIDDEN,
    errors?: ErrorDetailDto[],
    details?: TDetails | null,
  ) {
    super({ message, errorCode, errors, details }, HttpStatus.FORBIDDEN);
  }
}

// Internal Server Error Exception (HTTP 500)
export class InternalServerErrorException<
  TDetails = Record<string, unknown>,
> extends CustomHttpException<TDetails> {
  constructor(
    message = 'Internal server error',
    errorCode: ErrorCode = ERROR_CODES.INTERNAL_SERVER,
    errors?: ErrorDetailDto[],
    details?: TDetails | null,
  ) {
    super(
      { message, errorCode, errors, details },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
