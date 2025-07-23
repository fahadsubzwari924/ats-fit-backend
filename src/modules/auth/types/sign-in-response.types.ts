import { User } from '../../../database/entities/user.entity';
import { IFeatureUsage } from '../../../shared/interfaces/feature-usage.interface';

export type SignInResponse = {
  user: Omit<User, 'password'> & {
    featureUsage: Array<IFeatureUsage>;
  };
  access_token: string;
};
