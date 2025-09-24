import { Injectable } from '@nestjs/common';
import { UserContext as AuthUserContext } from '../../modules/auth/types/user-context.type';
import { GenericUserContextTransformer } from '../transformers/generic-user-context.transformer';

/**
 * User context transformation service
 * Provides a single generic transformation that ALL features should use
 * Follows SOLID principles with a single responsibility
 */
@Injectable()
export class UserContextTransformationService {
  constructor(private genericTransformer: GenericUserContextTransformer) {}

  /**
   * Transform auth context to standardized domain format
   * This is the ONLY transformation method - all features use this
   *
   * @param authContext - The authenticated user context
   * @returns Transformed context with standardized userType
   */
  transform(authContext?: AuthUserContext): {
    userId?: string;
    guestId?: string;
    userType: 'guest' | 'freemium' | 'premium';
    [key: string]: any;
  } {
    if (!authContext) {
      // Default guest context when no auth provided
      return {
        userType: 'guest',
        guestId: 'anonymous',
        userId: undefined,
      };
    }

    return this.genericTransformer.transform(authContext);
  }

  /**
   * Check if transformation is possible
   * @param authContext - Auth context to validate
   * @returns true if transformation is possible
   */
  canTransform(authContext?: AuthUserContext): boolean {
    if (!authContext) {
      return true; // Can always create default guest context
    }
    return this.genericTransformer.canTransform(authContext);
  }
}
