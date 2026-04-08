export type UserContext = {
  userId?: string;
  userType: string;
  plan?: string;
  isPremium?: boolean;
  ipAddress: string;
  userAgent: string;
  [key: string]: any;
};
