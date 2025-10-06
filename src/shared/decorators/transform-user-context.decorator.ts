import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for the transform user context decorator
 */
export const TRANSFORM_USER_CONTEXT_KEY = 'transform-user-context';

/**
 * Transform User Context Decorator
 *
 * Marks a controller method to automatically transform the auth user context
 * to the standardized domain format. ALL features use the same transformation.
 *
 * This decorator works in conjunction with the TransformUserContextInterceptor
 * to provide clean, declarative user context transformation.
 *
 * @example
 * ```typescript
 * @TransformUserContext()
 * @Post('generate')
 * async generateResume(@Req() request: RequestWithUserContext) {
 *   // request.userContext is now transformed to standardized format
 * }
 * ```
 */
export const TransformUserContext = () =>
  SetMetadata(TRANSFORM_USER_CONTEXT_KEY, true);
