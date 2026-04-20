import { Resume } from '../../../database/entities/resume.entity';
import { IFeatureUsage } from '../../../shared/interfaces/feature-usage.interface';
import { UserPlan, UserType } from '../../../database/entities/user.entity';

export class UserMeResponseDto {
  id: string;
  full_name: string;
  email: string;
  plan: UserPlan;
  isPremium: boolean;
  user_type: UserType;
  is_active: boolean;
  onboarding_completed: boolean;
  created_at: Date;
  updated_at: Date;
  featureUsage: IFeatureUsage[];
  uploadedResumes: Resume[];
}
