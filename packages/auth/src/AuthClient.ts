export interface AuthIdentity {
  userId: string;
  /** Present when the backend returns it; used only for display. */
  email?: string;
}

export interface AuthSession extends AuthIdentity {
  accessToken: string;
  refreshToken?: string;
}

export interface AuthClient {
  signIn(email: string, password: string): Promise<AuthSession>;
  /**
   * Returns a session when the backend signs the account in immediately, or
   * null when it requires the address to be confirmed by email first.
   */
  signUp(
    email: string,
    password: string,
    emailRedirectTo?: string,
  ): Promise<AuthSession | null>;
  restoreSession(): Promise<AuthSession | null>;
  signOut(): Promise<void>;
  /** Sends the "reset your password" email. */
  requestPasswordReset?(email: string, redirectTo?: string): Promise<void>;
  /** Sets a new password for the recovery session. */
  updatePassword?(password: string): Promise<void>;
  /** Adopts a session carried by a recovery deep link. */
  restoreFromUrl?(url: string): Promise<AuthIdentity | null>;
  /** Re-authenticates with the current password, then sets a new one. */
  changePassword?(currentPassword: string, newPassword: string): Promise<void>;
  /** Revokes every refresh token for the account, not just this device. */
  signOutEverywhere?(): Promise<void>;
  subscribe?(
    listener: (identity: AuthIdentity | null, event?: string) => void,
  ): () => void;
}
