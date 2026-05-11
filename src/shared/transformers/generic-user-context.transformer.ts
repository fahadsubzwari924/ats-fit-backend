import { Injectable } from '@nestjs/common';
import { UserContext as AuthUserContext } from '../../modules/auth/types/user-context.type';
import { UserPlan, UserType } from '../../database/entities/user.entity';

export type DomainUserPlan = 'freemium' | 'premium';

export interface DomainUserContext extends AuthUserContext {
  userType: UserType;
  plan: DomainUserPlan;
  isPremium: boolean;
}

/**
 * Normalizes the auth-middleware user context for downstream domain code.
 *
 * - `userType` stays the persistence-layer `UserType` enum value (`'registered'`).
 *   It must not be conflated with plan tier — DB columns of type `user_type_enum`
 *   only accept `'registered'`, so passing `'premium'` here causes PostgreSQL to
 *   reject the query.
 * - `plan` is normalized to `'freemium' | 'premium'`. All plan-tier branching in
 *   downstream code MUST use `plan` (or `isPremium`), never `userType`.
 */
@Injectable()
export class GenericUserContextTransformer {
  transform(authContext: AuthUserContext): DomainUserContext {
    const plan: DomainUserPlan =
      (authContext.plan as UserPlan) === UserPlan.PREMIUM ||
      authContext.isPremium === true
        ? 'premium'
        : 'freemium';

    return {
      ...authContext,
      userType: UserType.REGISTERED,
      plan,
      isPremium: plan === 'premium',
    };
  }

  canTransform(authContext: AuthUserContext): boolean {
    return authContext != null;
  }
}
