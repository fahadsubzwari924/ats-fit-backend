import { UserContext } from '../../modules/auth/types/user-context.type';

export interface RequestUser {
  userId: string;
  [key: string]: any;
}

export interface RequestWithUserContext extends Request {
  userContext?: UserContext;
}
