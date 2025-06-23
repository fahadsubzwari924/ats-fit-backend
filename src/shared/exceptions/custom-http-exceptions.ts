import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorDetailDto } from '../modules/response/response.dto';
import { ERROR_CODES, ErrorCode } from '../constants/error-codes';

// Base interface for custom exception data
interface CustomExceptionData {
  message: string;
  errorCode: string;
  errors?: ErrorDetailDto[];
}

// Base custom exception class
export class CustomHttpException extends HttpException {
  constructor(data: CustomExceptionData, status: HttpStatus) {
    super(
      {
        message: data.message,
        errorCode: data.errorCode,
        errors: data.errors || null,
      },
      status,
    );
  }
}

// Not Found Exception (HTTP 404)
export class NotFoundException extends CustomHttpException {
  constructor(
    message = 'Resource not found',
    errorCode: ErrorCode = ERROR_CODES.NOT_FOUND,
  ) {
    super({ message, errorCode }, HttpStatus.NOT_FOUND);
  }
}

// Bad Request Exception (HTTP 400)
export class BadRequestException extends CustomHttpException {
  constructor(
    message = 'Invalid input',
    errorCode: ErrorCode = ERROR_CODES.BAD_REQUEST,
    errors?: ErrorDetailDto[],
  ) {
    super({ message, errorCode, errors }, HttpStatus.BAD_REQUEST);
  }
}

// Unauthorized Exception (HTTP 401)
export class UnauthorizedException extends CustomHttpException {
  constructor(
    message = 'Unauthorized access',
    errorCode: ErrorCode = ERROR_CODES.UNAUTHORIZED,
  ) {
    super({ message, errorCode }, HttpStatus.UNAUTHORIZED);
  }
}

// Forbidden Exception (HTTP 403)
export class ForbiddenException extends CustomHttpException {
  constructor(
    message = 'Access forbidden',
    errorCode: ErrorCode = ERROR_CODES.FORBIDDEN,
  ) {
    super({ message, errorCode }, HttpStatus.FORBIDDEN);
  }
}

// Internal Server Error Exception (HTTP 500)
export class InternalServerErrorException extends CustomHttpException {
  constructor(
    message = 'Internal server error',
    errorCode: ErrorCode = ERROR_CODES.INTERNAL_SERVER,
  ) {
    super({ message, errorCode }, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
