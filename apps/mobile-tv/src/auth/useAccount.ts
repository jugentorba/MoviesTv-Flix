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
}

export const AccountContext = createContext<AccountApi | null>(null);

export function useAccount(): AccountApi {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount must be used inside AccountContext');
  return value;
}
