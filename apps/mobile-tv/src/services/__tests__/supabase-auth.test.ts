import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createSupabaseClient,
  SupabaseAuthClient,
} from '../supabase';

test('Supabase auth subscription emits identity only and unsubscribes', () => {
  let callback: ((event: string, session: any) => void) | null = null;
  const unsubscribe = jest.fn();
  const onAuthStateChange = jest.fn((next) => {
    callback = next;
    return {
      data: {
        subscription: { unsubscribe },
      },
    };
  });
  const client = {
    auth: { onAuthStateChange },
  } as unknown as SupabaseClient;
  const auth = new SupabaseAuthClient(client);
  const listener = jest.fn();

  const stop = auth.subscribe(listener);
  (callback as ((event: string, session: any) => void) | null)?.('SIGNED_IN', {
    user: { id: ' user-1 ' },
    access_token: ' ACCESS-SECRET ',
    refresh_token: ' REFRESH-SECRET ',
  });

  // The event travels alongside the identity so a recovery link can open the
  // set-password screen without exposing tokens.
  expect(listener).toHaveBeenCalledWith({
    userId: 'user-1',
  }, 'SIGNED_IN');
  expect(JSON.stringify(listener.mock.calls))
    .not.toContain('ACCESS-SECRET');
  expect(JSON.stringify(listener.mock.calls))
    .not.toContain('REFRESH-SECRET');

  stop();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('Supabase auth adapter disposes the underlying client lifecycle', async () => {
  const dispose = jest.fn(async () => undefined);
  const client = {
    auth: { dispose },
  } as unknown as SupabaseClient;
  const auth = new SupabaseAuthClient(client);

  await expect(auth.dispose()).resolves.toBeUndefined();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('Supabase auth rejects control characters in synchronized account ids', async () => {
  const invalidSession = {
    user: { id: 'user-1\u0000other' },
    access_token: 'access-token',
    refresh_token: 'refresh-token',
  };
  const client = {
    auth: {
      getSession: async () => ({
        data: { session: invalidSession },
        error: null,
      }),
      signInWithPassword: async () => ({
        data: { session: invalidSession },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
  const auth = new SupabaseAuthClient(client);

  await expect(auth.restoreSession()).resolves.toBeNull();
  await expect(auth.signIn(
    'user@example.com',
    'password',
  )).rejects.toThrow('Authentication session was not returned');
});

test('Supabase auth subscription maps invalid or signed-out sessions to null', () => {
  let callback: ((event: string, session: any) => void) | null = null;
  const client = {
    auth: {
      onAuthStateChange: (next: any) => {
        callback = next;
        return {
          data: {
            subscription: { unsubscribe: jest.fn() },
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  const auth = new SupabaseAuthClient(client);
  const listener = jest.fn();

  auth.subscribe(listener);
  (callback as ((event: string, session: any) => void) | null)?.('SIGNED_OUT', null);
  (callback as ((event: string, session: any) => void) | null)?.('SIGNED_IN', {
    user: { id: '' },
    access_token: 'token',
    refresh_token: 'refresh',
  });

  expect(listener).toHaveBeenNthCalledWith(1, null, 'SIGNED_OUT');
  expect(listener).toHaveBeenNthCalledWith(2, null, 'SIGNED_IN');
});


const storage = {
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
};

test('Supabase client creation honors validated local development URLs', () => {
  const client = createSupabaseClient({
    ok: true,
    url: 'http://127.0.0.1:54321',
    publishableKey: 'local-public-key',
  }, storage);

  expect(client).not.toBeNull();
});

test('Supabase client creation rejects direct unsafe config bypasses', () => {
  const encode = (value: object) => (
    Buffer.from(JSON.stringify(value)).toString('base64url')
  );
  const serviceRoleJwt = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ role: 'service_role' }),
    'signature',
  ].join('.');

  for (const config of [
    {
      ok: true as const,
      url: 'https://example.supabase.co?token=leak',
      publishableKey: 'public-key',
    },
    {
      ok: true as const,
      url: 'https://example.supabase.co',
      publishableKey: 'sb_secret_never-public',
    },
    {
      ok: true as const,
      url: 'https://example.supabase.co',
      publishableKey: serviceRoleJwt,
    },
  ]) {
    expect(createSupabaseClient(config, storage)).toBeNull();
  }
});


const authTimeoutCases: Array<[
  string,
  (auth: SupabaseAuthClient) => Promise<unknown>,
]> = [
  ['restore', async (auth) => auth.restoreSession()],
  ['sign-in', async (auth) => (
    auth.signIn('user@example.com', 'password')
  )],
  ['sign-up', async (auth) => (
    auth.signUp('user@example.com', 'password')
  )],
  ['sign-out', async (auth) => auth.signOut()],
];

test.each(authTimeoutCases)(
  'bounds stalled Supabase auth %s requests',
  async (_label, run) => {
    const never = () => new Promise(() => undefined);
    const client = {
      auth: {
        getSession: never,
        signInWithPassword: never,
        signUp: never,
        signOut: never,
      },
    } as unknown as SupabaseClient;
    const auth = new SupabaseAuthClient(client, 2);

    await expect(run(auth))
      .rejects.toThrow('Authentication request timed out');
  },
);

test('rejects invalid Supabase auth timeout configuration before requests', async () => {
  const getSession = jest.fn();
  const auth = new SupabaseAuthClient({
    auth: { getSession },
  } as unknown as SupabaseClient, 0);

  await expect(auth.restoreSession())
    .rejects.toThrow('Authentication timeout is invalid');
  expect(getSession).not.toHaveBeenCalled();
});


test('sign out only ends the current Supabase session', async () => {
  const signOut = jest.fn(async () => ({ error: null }));
  const client = {
    auth: { signOut },
  } as unknown as SupabaseClient;
  const auth = new SupabaseAuthClient(client);

  await expect(auth.signOut()).resolves.toBeUndefined();
  expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
});
