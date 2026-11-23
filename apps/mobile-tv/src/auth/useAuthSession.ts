import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import type {
  AuthClient,
  AuthIdentity,
} from '@moviestv/auth';
import { safeAuthErrorMessage } from './authError';
import { passwordProblem, signInPasswordValid } from './passwordPolicy';
import { authLinkType, parseRecoveryTokens } from './recoveryLink';

/** Where Supabase should send the user after they follow an email link. */
function recoveryRedirect(): string | undefined {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || !window.location?.origin) return undefined;
    return `${window.location.origin}/`;
  }
  return 'moviestvflix://auth/reset';
}

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
  const email = session.email?.trim();
  return {
    userId,
    ...(email ? { email } : {}),
  };
}

export function useAuthSession(client: AuthClient) {
  // Keep bearer/refresh tokens inside the Supabase client/storage layer rather
  // than React state. The UI only needs the stable account identity.
  const [session, setSession] = useState<AuthIdentity | null>(null);
  const [sessionClient, setSessionClient] = useState(client);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string>();
  // A recovery link puts the app into "choose a new password" before anything
  // else, even though the session behind it is a normal one.
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const operationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const restoreOperation = ++operationRef.current;
    setSessionClient(client);
    setSession(null);
    setLoading(true);
    setMessage(undefined);

    const unsubscribe = client.subscribe?.((value, event) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
      // Auth-state events are authoritative. Invalidate any stale restore or
      // action completion so another tab/device-side change cannot be undone
      // by an older promise resolving afterward.
      operationRef.current += 1;
      setSession(identityOf(value));
      setMessage(undefined);
      setLoading(false);
    });

    // Browser recovery links are parsed by the Supabase client itself; the
    // native app has to read its own deep link and adopt the session tokens.
    if (Platform.OS !== 'web' && client.restoreFromUrl) {
      const adopt = (url: string | null) => {
        if (!active || !url) return;
        const tokens = parseRecoveryTokens(url);
        if (!tokens) return;
        operationRef.current += 1;
        // A confirmation link also carries tokens; only a reset link may ask
        // for a new password.
        if (authLinkType(url) === 'recovery') {
          setPasswordRecovery(true);
        }
        setLoading(true);
        void client.restoreFromUrl?.(url).then((value) => {
          if (!active) return;
          setSession(identityOf(value));
        }).catch((error) => {
          if (active) setMessage(safeAuthErrorMessage(error));
        }).finally(() => {
          if (active) setLoading(false);
        });
      };
      void Linking.getInitialURL().then(adopt).catch(() => undefined);
      const subscription = Linking.addEventListener('url', ({ url }) => adopt(url));
      return () => {
        active = false;
        unsubscribe?.();
        subscription.remove();
      };
    }

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
    if (!validEmail(email) || !signInPasswordValid(password)) {
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
    if (!validEmail(email) || passwordProblem(password)) {
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
        recoveryRedirect(),
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

  const requestPasswordReset = useCallback(async (email: string) => {
    if (!client.requestPasswordReset) return false;
    if (!validEmail(email)) {
      setMessage('Invalid email or password.');
      return false;
    }

    const operation = ++operationRef.current;
    setLoading(true);
    setMessage(undefined);
    try {
      await client.requestPasswordReset(
        email.trim().toLowerCase(),
        recoveryRedirect(),
      );
      if (operation !== operationRef.current) return false;
      return true;
    } catch (error) {
      if (operation === operationRef.current) {
        setMessage(safeAuthErrorMessage(error));
      }
      return false;
    } finally {
      if (operation === operationRef.current) {
        setLoading(false);
      }
    }
  }, [client]);

  const updatePassword = useCallback(async (password: string) => {
    if (!client.updatePassword) return false;
    if (passwordProblem(password)) {
      setMessage('Invalid email or password.');
      return false;
    }

    const operation = ++operationRef.current;
    setLoading(true);
    setMessage(undefined);
    try {
      await client.updatePassword(password);
      if (operation !== operationRef.current) return false;
      setPasswordRecovery(false);
      return true;
    } catch (error) {
      if (operation === operationRef.current) {
        setMessage(safeAuthErrorMessage(error));
      }
      return false;
    } finally {
      if (operation === operationRef.current) {
        setLoading(false);
      }
    }
  }, [client]);

  const changePassword = useCallback(async (
    currentPassword: string,
    newPassword: string,
  ) => {
    if (!client.changePassword) return false;
    if (!signInPasswordValid(currentPassword) || passwordProblem(newPassword)) {
      setMessage('Invalid email or password.');
      return false;
    }
    const operation = ++operationRef.current;
    setLoading(true);
    setMessage(undefined);
    try {
      await client.changePassword(currentPassword, newPassword);
      if (operation !== operationRef.current) return false;
      return true;
    } catch (error) {
      if (operation === operationRef.current) {
        setMessage(safeAuthErrorMessage(error));
      }
      return false;
    } finally {
      if (operation === operationRef.current) {
        setLoading(false);
      }
    }
  }, [client]);

  const signOutEverywhere = useCallback(async () => {
    if (!client.signOutEverywhere) return false;
    const operation = ++operationRef.current;
    setLoading(true);
    try {
      await client.signOutEverywhere();
      if (operation !== operationRef.current) return false;
      setSession(null);
      setMessage(undefined);
      return true;
    } catch (error) {
      if (operation === operationRef.current) {
        setMessage(safeAuthErrorMessage(error));
      }
      return false;
    } finally {
      if (operation === operationRef.current) {
        setLoading(false);
      }
    }
  }, [client]);

  const finishRecovery = useCallback(() => {
    setPasswordRecovery(false);
  }, []);

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
    requestPasswordReset,
    updatePassword,
    finishRecovery,
    passwordRecovery,
    changePassword,
    signOutEverywhere,
  };
}
