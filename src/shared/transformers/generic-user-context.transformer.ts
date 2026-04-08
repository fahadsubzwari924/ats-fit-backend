import { Injectable } from '@nestjs/common';
import { UserContext as AuthUserContext } from '../../modules/auth/types/user-context.type';

/**
 * Maps auth middleware context (registered user + plan) to domain plan tier
 * used by resume tailoring: `freemium` | `premium`.
 */
@Injectable()
export class GenericUserContextTransformer {
  transform(authContext: AuthUserContext): {
    userId?: string;
    userType: 'freemium' | 'premium';
    [key: string]: unknown;
  } {
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

    if (['freemium', 'premium'].includes(String(authContext.userType))) {
      return {
        ...authContext,
        userType: authContext.userType as 'freemium' | 'premium',
      };
    }

    return {
      ...authContext,
      userType: 'freemium',
    };
  }

  canTransform(authContext: AuthUserContext): boolean {
    return authContext != null;
  }
}
