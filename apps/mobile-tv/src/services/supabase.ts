import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AuthClient,
  AuthIdentity,
  AuthSession,
} from '@moviestv/auth';
import type { AsyncStorageLike } from '@moviestv/storage';
import {
  readSupabaseConfig,
  type SupabaseConfigResult,
} from './runtime';

export const DEFAULT_AUTH_REQUEST_TIMEOUT_MS = 10_000;

async function withAuthTimeout<T>(
  operation: () => PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Authentication timeout is invalid');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('Authentication request timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sessionOf(session: {
  user?: { id?: string };
  access_token?: string;
  refresh_token?: string;
} | null | undefined): AuthSession | null {
  if (!session) return null;

  const userId = session.user?.id?.trim();
  const accessToken = session.access_token?.trim();
  const refreshToken = session.refresh_token?.trim();
  if (
    !userId
    || userId.length > 512
    || /[\u0000-\u001f\u007f]/.test(userId)
    || !accessToken
    || accessToken.length > 16_384
    || (refreshToken && refreshToken.length > 16_384)
  ) return null;

  return {
    userId,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
  };
}

export class SupabaseAuthClient implements AuthClient {
  constructor(
    private readonly client: SupabaseClient,
    private readonly timeoutMs = DEFAULT_AUTH_REQUEST_TIMEOUT_MS,
  ) {}

  async dispose() {
    await this.client.auth.dispose();
  }

  async restoreSession() {
    const { data, error } = await withAuthTimeout(
      () => this.client.auth.getSession(),
      this.timeoutMs,
    );
    if (error) throw error;
    return sessionOf(data.session);
  }

  async signIn(email: string, password: string) {
    const { data, error } = await withAuthTimeout(
      () => this.client.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      }),
      this.timeoutMs,
    );
    if (error) throw error;
    const session = sessionOf(data.session);
    if (!session) {
      throw new Error('Authentication session was not returned');
    }
    return session;
  }

  async signUp(email: string, password: string) {
    const { data, error } = await withAuthTimeout(
      () => this.client.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      }),
      this.timeoutMs,
    );
    if (error) throw error;
    return sessionOf(data.session);
  }

  async signOut() {
    const { error } = await withAuthTimeout(
      () => this.client.auth.signOut({ scope: 'local' }),
      this.timeoutMs,
    );
    if (error) throw error;
  }
  subscribe(listener: (identity: AuthIdentity | null) => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((_event, session) => {
      const authenticated = sessionOf(session);
      listener(
        authenticated
          ? { userId: authenticated.userId }
          : null,
      );
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }
}

export function createSupabaseClient(
  config: SupabaseConfigResult,
  storage: AsyncStorageLike,
): SupabaseClient | null {
  if (!config.ok) return null;
  const validated = readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: config.url,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.publishableKey,
  });
  if (!validated.ok) return null;

  const url = validated.url;
  const publishableKey = validated.publishableKey;
  if (
    url.length > 2_048
    || publishableKey.length > 8_192
  ) return null;

  return createClient(url, publishableKey, {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}

export function createSupabaseAuthClient(
  config: SupabaseConfigResult,
  storage: AsyncStorageLike,
): SupabaseAuthClient | null {
  const client = createSupabaseClient(config, storage);
  return client ? new SupabaseAuthClient(client) : null;
}
