import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { TRANSFORM_USER_CONTEXT_KEY } from '../decorators/transform-user-context.decorator';
import { UserContextTransformationService } from '../services/user-context-transformation.service';
import { RequestWithUserContext } from '../interfaces/request-user.interface';

/**
 * Transform User Context Interceptor
 *
 * Automatically transforms the auth user context to standardized domain format
 * when a route is marked with the @TransformUserContext() decorator.
 *
 * This interceptor follows NestJS best practices by:
 * - Using reflector to check for decorator metadata
 * - Modifying the request object before it reaches the route handler
 * - Being non-intrusive (only acts when decorator is present)
 * - Following Single Responsibility Principle
 *
 * @example
 * ```typescript
 * @TransformUserContext()
 * @Post('generate')
 * async generateResume(@Req() request: RequestWithUserContext) {
 *   // request.userContext is now in standardized format
 * }
 * ```
 */
@Injectable()
export class TransformUserContextInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly userContextTransformationService: UserContextTransformationService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Check if transformation is enabled for this route
    const shouldTransform = this.reflector.getAllAndOverride<boolean>(
      TRANSFORM_USER_CONTEXT_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no transformation is needed, proceed normally
    if (!shouldTransform) {
      return next.handle();
    }

    // Get the request object
    const request = context.switchToHttp().getRequest<RequestWithUserContext>();

    // Transform the user context using the generic transformation
    try {
      const transformedContext =
        this.userContextTransformationService.transform(request.userContext);

      // Update the request with transformed context
      Object.assign(request, { userContext: transformedContext });
    } catch (error) {
      // Log the error but don't break the request flow
      console.error('User context transformation failed:', error);
      // Optionally, you could throw an exception here if transformation is critical
    }

    return next.handle();
  }
}
