export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthRequest {
  user: AuthUser;
}
