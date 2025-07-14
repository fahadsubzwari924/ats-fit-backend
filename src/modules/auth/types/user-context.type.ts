export type UserContext = {
  userId?: string;
  guestId?: string;
  userType: string;
  plan?: string;
  ipAddress: string;
  userAgent: string;
  [key: string]: any;
};
