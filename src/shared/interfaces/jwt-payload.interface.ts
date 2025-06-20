export interface JwtPayload {
  sub: string; // or `number` depending on your user ID type
  email: string;
}
