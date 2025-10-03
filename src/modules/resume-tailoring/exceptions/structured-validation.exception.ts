import { BadRequestException } from '../../../shared/exceptions/custom-http-exceptions';
import { ValidationError } from '../../../shared/modules/validation';
import { ERROR_CODES, ErrorCode } from '../../../shared/constants/error-codes';

/**
 * Structured Validation Exception
 *
 * Custom exception that carries structured validation errors with error codes
 * for proper error handling and front-end translation.
 */
export class StructuredValidationException extends BadRequestException {
  public readonly structuredErrors: ValidationError[];

  constructor(
    structuredErrors: ValidationError | ValidationError[],
    fallbackErrorCode?: ErrorCode,
  ) {
    const errorsArray = Array.isArray(structuredErrors)
      ? structuredErrors
      : [structuredErrors];

    // Extract messages for the parent exception
    const messages = errorsArray.map((error) => error.message);
    const combinedMessage = messages.join('; ');

    // Use the first error's code as the exception code, or fallback
    const errorCode =
      (errorsArray[0]?.code as ErrorCode) ||
      fallbackErrorCode ||
      ERROR_CODES.BAD_REQUEST;

    super(combinedMessage, errorCode);

    this.structuredErrors = errorsArray;
  }

  /**
   * Get the primary error code (from first error)
   */
  getPrimaryErrorCode(): string {
    return this.structuredErrors[0]?.code || ERROR_CODES.BAD_REQUEST;
  }

  /**
   * Get all error codes
   */
  getAllErrorCodes(): string[] {
    return this.structuredErrors
      .map((error) => error.code)
      .filter((code): code is string => !!code);
  }

  /**
   * Check if exception contains a specific error code
   */
  hasErrorCode(code: string): boolean {
    return this.getAllErrorCodes().includes(code);
  }
}
