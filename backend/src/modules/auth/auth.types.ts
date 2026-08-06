export interface AuthClaims {
  wallet: string;
  sessionId: string;
  exp: number;
  iat: number;
}

export interface AuthRequestLike {
  auth?: AuthClaims;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  headers?: Record<string, string | string[] | undefined>;
}
