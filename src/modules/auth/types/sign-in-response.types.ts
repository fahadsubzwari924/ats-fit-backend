import { UserMeResponseDto } from '../../user/dtos/user-me-response.dto';

export type SignInResponse = {
  user: UserMeResponseDto;
  access_token: string;
};
