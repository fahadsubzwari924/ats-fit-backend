export type UserContext = {
  userId?: string;
  guestId?: string;
  userType: string;
  plan?: string;
  isPremium?: boolean;
  ipAddress: string;
  userAgent: string;
  [key: string]: any;
};
