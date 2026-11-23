import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuthClient,
  AuthIdentity,
} from '@moviestv/auth';
import { safeAuthErrorMessage } from './authError';

function validEmail(email: string): boolean {
  const normalized = email.trim();
  const parts = normalized.split('@');
  return normalized.length <= 320
    && !/\s/.test(normalized)
    && parts.length === 2
    && Boolean(parts[0])
    && Boolean(parts[1]?.includes('.'));
}

function identityOf(
  session: AuthIdentity | null,
): AuthIdentity | null {
  if (!session) return null;
  const userId = session.userId?.trim();
  if (
    !userId
    || userId.length > 512
    || /[\u0000-\u001f\u007f]/.test(userId)
  ) return null;
  return { userId };
}

export function useAuthSession(client: AuthClient) {
  // Keep bearer/refresh tokens inside the Supabase client/storage layer rather
  // than React state. The UI only needs the stable account identity.
  const [session, setSession] = useState<AuthIdentity | null>(null);
  const [sessionClient, setSessionClient] = useState(client);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  const operationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const restoreOperation = ++operationRef.current;
    setSessionClient(client);
    setSession(null);
    setLoading(true);
    setMessage(undefined);

    const unsubscribe = client.subscribe?.((value) => {
      if (!active) return;
      // Auth-state events are authoritative. Invalidate any stale restore or
      // action completion so another tab/device-side change cannot be undone
      // by an older promise resolving afterward.
      operationRef.current += 1;
      setSession(identityOf(value));
      setMessage(undefined);
      setLoading(false);
    });

    void client.restoreSession()
      .then((value) => {
        if (
          active
          && restoreOperation === operationRef.current
        ) {
          setSession(identityOf(value));
        }
      })
      .catch((error) => {
        if (
          active
          && restoreOperation === operationRef.current
        ) {
          setMessage(safeAuthErrorMessage(error));
        }
      })
      .finally(() => {
        if (
          active
          && restoreOperation === operationRef.current
        ) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [client]);

  const signIn = useCallback(async (
    email: string,
    password: string,
  ) => {
    if (
      !validEmail(email)
      || password.length < 6
      || password.length > 1024
    ) {
      setMessage('Invalid email or password.');
      return;
    }

    const operation = ++operationRef.current;
    setLoading(true);
    setMessage(undefined);
    try {
      const next = await client.signIn(
        email.trim().toLowerCase(),
        password,
      );
      if (operation !== operationRef.current) return;
      setSession(identityOf(next));
      setMessage(undefined);
    } catch (error) {
      if (operation === operationRef.current) {
        setMessage(safeAuthErrorMessage(error));
      }
    } finally {
      if (operation === operationRef.current) {
        setLoading(false);
      }
    }
  }, [client]);

  const signUp = useCallback(async (
    email: string,
    password: string,
  ) => {
    if (
      !validEmail(email)
      || password.length < 6
      || password.length > 1024
    ) {
      setMessage('Invalid email or password.');
      return;
    }

    const operation = ++operationRef.current;
    setLoading(true);
    setMessage(undefined);
    try {
      const next = await client.signUp(
        email.trim().toLowerCase(),
        password,
      );
      if (operation !== operationRef.current) return;
      setSession(identityOf(next));
      setMessage(
        next
          ? undefined
          : 'Check your email to confirm your account.',
      );
    } catch (error) {
      if (operation === operationRef.current) {
        setMessage(safeAuthErrorMessage(error));
      }
    } finally {
      if (operation === operationRef.current) {
        setLoading(false);
      }
    }
  }, [client]);

  const signOut = useCallback(async () => {
    const operation = ++operationRef.current;
    setLoading(true);
    try {
      await client.signOut();
      if (operation !== operationRef.current) return;
      setSession(null);
      setMessage(undefined);
    } catch (error) {
      if (operation === operationRef.current) {
        setMessage(safeAuthErrorMessage(error));
      }
    } finally {
      if (operation === operationRef.current) {
        setLoading(false);
      }
    }
  }, [client]);

  // Hide the previous backend's identity on the first replacement render,
  // before effects run and account-scoped consumers can start synchronization.
  const belongsToClient = sessionClient === client;
  return {
    session: belongsToClient ? session : null,
    loading: belongsToClient ? loading : true,
    message: belongsToClient ? message : undefined,
    signIn,
    signUp,
    signOut,
  };
}
