import { createContext, useContext } from 'react';

export interface AccountApi {
  backendAvailable: boolean;
  userId: string | null;
  loading: boolean;
  message?: string;
  retryBackend?(): void;
  configureBackend?(url: string, publishableKey: string): Promise<boolean>;
  resetBackend?(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Sends a reset email; resolves false when the backend refused or is absent. */
  requestPasswordReset?(email: string): Promise<boolean>;
  /** Sets a new password for the recovery session. */
  updatePassword?(password: string): Promise<boolean>;
  /** Leaves the "choose a new password" screen. */
  finishRecovery?(): void;
  passwordRecovery?: boolean;
  /** Re-authenticates, then sets a new password for a signed-in account. */
  changePassword?(currentPassword: string, newPassword: string): Promise<boolean>;
  /** Revokes every session of the account. */
  signOutEverywhere?(): Promise<boolean>;
  /** Address of the signed-in account, for display only. */
  email?: string;
}

export const AccountContext = createContext<AccountApi | null>(null);

export function useAccount(): AccountApi {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside AccountContext');
  return value;
}
