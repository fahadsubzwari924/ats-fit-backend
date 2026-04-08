import { Injectable } from '@nestjs/common';
import { UserContext as AuthUserContext } from '../../modules/auth/types/user-context.type';
import { GenericUserContextTransformer } from '../transformers/generic-user-context.transformer';

@Injectable()
export class UserContextTransformationService {
  constructor(private genericTransformer: GenericUserContextTransformer) {}

  transform(authContext: AuthUserContext): {
    userId?: string;
    userType: 'freemium' | 'premium';
    [key: string]: unknown;
  } {
    return this.genericTransformer.transform(authContext);
  }

  canTransform(authContext?: AuthUserContext): boolean {
    if (!authContext) {
      return false;
    }
    return this.genericTransformer.canTransform(authContext);
  }
}
