import { InternalServerErrorException } from '@nestjs/common';

/**
 * Utility class for AI service error detection and handling
 * Provides centralized methods for detecting different types of AI service errors
 */
export class AIErrorUtil {
  /**
   * Checks if an error is a Claude API overload error (HTTP 529)
   * Handles various error formats including wrapped exceptions and stack traces
   *
   * @param error - The error to check (can be string, Error object, or any other type)
   * @returns true if the error indicates Claude API overload, false otherwise
   */
  static isClaudeOverloadError(error: unknown): boolean {
    if (!error) return false;

    // Convert error to string for pattern matching
    let errorString = '';
    let stackString = '';

    if (typeof error === 'string') {
      errorString = error;
    } else if (error instanceof Error) {
      errorString = error.message;
      stackString = error.stack || '';
    } else if (typeof error === 'object' && error !== null) {
      const errorObj = error as Record<string, unknown>;

      // Check if it's an InternalServerErrorException from Claude service
      if (error instanceof InternalServerErrorException) {
        errorString = error.message;
        stackString = error.stack || '';
      } else if (errorObj.response && typeof errorObj.response === 'object') {
        // Handle NestJS exceptions
        const response = errorObj.response as Record<string, unknown>;
        errorString =
          typeof response.message === 'string' ? response.message : '';
      } else if (typeof errorObj.message === 'string') {
        // Fallback to direct message
        errorString = errorObj.message;
      }

      // Include stack trace for more comprehensive checking
      if (!stackString && typeof errorObj.stack === 'string') {
        stackString = errorObj.stack;
      }
    }

    const combinedString = `${errorString} ${stackString}`.toLowerCase();

    return (
      combinedString.includes('529') ||
      combinedString.includes('overloaded') ||
      combinedString.includes('overloaded_error') ||
      combinedString.includes('claude api error: 529') ||
      combinedString.includes('unexpected error in retry logic') ||
      combinedString.includes(
        'claude api overloaded - immediate fallback required',
      )
    );
  }

  /**
   * Checks if an error is an OpenAI API rate limit or quota error
   *
   * @param error - The error to check
   * @returns true if the error indicates OpenAI rate limiting/quota issues
   */
  static isOpenAIRateLimitError(error: unknown): boolean {
    if (!error) return false;

    let errorString = '';
    if (typeof error === 'string') {
      errorString = error;
    } else if (error instanceof Error) {
      errorString = error.message;
    } else if (typeof error === 'object' && error !== null) {
      const errorObj = error as Record<string, unknown>;
      errorString =
        typeof errorObj.message === 'string' ? errorObj.message : '';
    }

    const lowerErrorString = errorString.toLowerCase();

    return (
      lowerErrorString.includes('rate limit') ||
      lowerErrorString.includes('rate_limit') ||
      lowerErrorString.includes('quota') ||
      lowerErrorString.includes('429') ||
      lowerErrorString.includes('too many requests')
    );
  }

  /**
   * Checks if an error is a temporary/retryable AI service error
   *
   * @param error - The error to check
   * @returns true if the error might be resolved by retrying
   */
  static isRetryableAIError(error: unknown): boolean {
    if (!error) return false;

    let errorString = '';
    if (typeof error === 'string') {
      errorString = error;
    } else if (error instanceof Error) {
      errorString = error.message;
    } else if (typeof error === 'object' && error !== null) {
      const errorObj = error as Record<string, unknown>;
      errorString =
        typeof errorObj.message === 'string' ? errorObj.message : '';
    }

    const lowerErrorString = errorString.toLowerCase();

    return (
      lowerErrorString.includes('timeout') ||
      lowerErrorString.includes('network') ||
      lowerErrorString.includes('connection') ||
      lowerErrorString.includes('502') ||
      lowerErrorString.includes('503') ||
      lowerErrorString.includes('504') ||
      lowerErrorString.includes('temporary') ||
      lowerErrorString.includes('server error')
    );
  }

  /**
   * Determines the appropriate fallback strategy for an AI service error
   *
   * @param error - The error to analyze
   * @returns Object containing recommended actions
   */
  static getErrorHandlingStrategy(error: unknown): {
    shouldRetry: boolean;
    shouldFallback: boolean;
    isOverload: boolean;
    errorType:
      | 'overload'
      | 'rate_limit'
      | 'retryable'
      | 'permanent'
      | 'unknown';
  } {
    if (this.isClaudeOverloadError(error)) {
      return {
        shouldRetry: false,
        shouldFallback: true,
        isOverload: true,
        errorType: 'overload',
      };
    }

    if (this.isOpenAIRateLimitError(error)) {
      return {
        shouldRetry: true,
        shouldFallback: false,
        isOverload: false,
        errorType: 'rate_limit',
      };
    }

    if (this.isRetryableAIError(error)) {
      return {
        shouldRetry: true,
        shouldFallback: true,
        isOverload: false,
        errorType: 'retryable',
      };
    }

    return {
      shouldRetry: false,
      shouldFallback: true,
      isOverload: false,
      errorType: 'unknown',
    };
  }

  /**
   * Extracts a human-readable error message from various error formats
   *
   * @param error - The error to extract message from
   * @returns Clean error message string
   */
  static extractErrorMessage(error: unknown): string {
    if (!error) return 'Unknown error';

    if (typeof error === 'string') {
      return error;
    }

    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null) {
      const errorObj = error as Record<string, unknown>;

      if (error instanceof InternalServerErrorException) {
        return error.message;
      }

      if (errorObj.response && typeof errorObj.response === 'object') {
        const response = errorObj.response as Record<string, unknown>;
        if (typeof response.message === 'string') {
          return response.message;
        }
      }

      if (typeof errorObj.message === 'string') {
        return errorObj.message;
      }
    }

    return 'Unknown error format';
  }
}
