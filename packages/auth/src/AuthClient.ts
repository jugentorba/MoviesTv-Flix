export interface AuthIdentity {
  userId: string;
}

export interface AuthSession extends AuthIdentity {
  accessToken: string;
  refreshToken?: string;
}

export interface AuthClient {
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string): Promise<AuthSession | null>;
  restoreSession(): Promise<AuthSession | null>;
  signOut(): Promise<void>;
  subscribe?(
    listener: (identity: AuthIdentity | null) => void,
  ): () => void;
}
