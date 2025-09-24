import { Injectable } from '@nestjs/common';
import { UserContext as AuthUserContext } from '../../modules/auth/types/user-context.type';

/**
 * Generic user context transformer
 * Handles the standard auth context to domain context mapping
 * ALL features should use this same transformation logic
 *
 * This transformer standardizes the mapping from:
 * - Auth userType: 'guest' | 'registered' | etc.
 * - Auth plan: 'free' | 'premium' | etc.
 *
 * To:
 * - Domain userType: 'guest' | 'freemium' | 'premium'
 *
 * This is the SINGLE source of truth for user context transformation
 */
@Injectable()
export class GenericUserContextTransformer {
  /**
   * Transform auth user context to standardized domain format
   * This is the generic transformation that all features should use
   *
   * @param authContext - Auth user context from middleware/guards
   * @returns Transformed context with standardized userType
   */
  transform(authContext: AuthUserContext): {
    userId?: string;
    guestId?: string;
    userType: 'guest' | 'freemium' | 'premium';
    [key: string]: any;
  } {
    // Handle guest users
    if (authContext.userType === 'guest') {
      return {
        ...authContext,
        userType: 'guest' as const,
      };
    }

    // Handle registered users - map by plan
    if (authContext.userType === 'registered') {
      const userType: 'freemium' | 'premium' =
        authContext.plan === 'premium' || authContext.isPremium === true
          ? 'premium'
          : 'freemium';

      return {
        ...authContext,
        userType,
      };
    }

    // Handle direct plan-based user types
    if (['freemium', 'premium'].includes(authContext.userType)) {
      return {
        ...authContext,
        userType: authContext.userType as 'freemium' | 'premium',
      };
    }

    // Default fallback - treat unknown user types as freemium
    return {
      ...authContext,
      userType: 'freemium' as const,
    };
  }

  /**
   * Validate if transformation is possible
   * @param authContext - Auth user context to validate
   * @returns true if transformation is possible
   */
  canTransform(authContext: AuthUserContext): boolean {
    return authContext != null;
  }
}
