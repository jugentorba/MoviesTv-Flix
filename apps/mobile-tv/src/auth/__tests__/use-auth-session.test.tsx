import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import type {
  AuthClient,
  AuthIdentity,
  AuthSession,
} from '@moviestv/auth';
import { useAuthSession } from '../useAuthSession';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function session(userId: string): AuthSession {
  return {
    userId,
    accessToken: `access-${userId}`,
    refreshToken: `refresh-${userId}`,
  };
}

function Probe({
  client,
  onSnapshot,
}: {
  client: AuthClient;
  onSnapshot(value: ReturnType<typeof useAuthSession>): void;
}) {
  const value = useAuthSession(client);
  useEffect(() => {
    onSnapshot(value);
  }, [
    onSnapshot,
    value.loading,
    value.message,
    value.session?.userId,
  ]);
  return (
    <Text testID="auth-state">
      {`${value.session?.userId ?? 'guest'}:${value.loading ? 'loading' : 'ready'}`}
    </Text>
  );
}

test('auth subscription wins over a stale session restore and exposes identity only', async () => {
  const restore = deferred<AuthSession | null>();
  let listener: ((identity: AuthIdentity | null) => void) | null = null;
  const unsubscribe = jest.fn();
  const client: AuthClient = {
    restoreSession: () => restore.promise,
    signIn: async () => session('local'),
    signUp: async () => session('local'),
    signOut: async () => undefined,
    subscribe: (next) => {
      listener = next;
      return unsubscribe;
    },
  };
  let latest: ReturnType<typeof useAuthSession> | null = null;
  const view = render(
    <Probe
      client={client}
      onSnapshot={(value) => { latest = value; }}
    />,
  );

  expect(screen.getByTestId('auth-state').props.children)
    .toBe('guest:loading');

  await act(async () => {
    listener?.({ userId: 'account-b' });
    await Promise.resolve();
  });

  expect(screen.getByTestId('auth-state').props.children)
    .toBe('account-b:ready');
  const subscribedSnapshot = latest as ReturnType<typeof useAuthSession> | null;
  expect(subscribedSnapshot?.session).toEqual({ userId: 'account-b' });
  expect(JSON.stringify(subscribedSnapshot?.session)).not.toMatch(
    /access|refresh|token/i,
  );

  await act(async () => {
    restore.resolve(session('stale-account-a'));
    await restore.promise;
    await Promise.resolve();
  });

  expect(screen.getByTestId('auth-state').props.children)
    .toBe('account-b:ready');

  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('session restore never exposes a credential-bearing backend error', async () => {
  const client: AuthClient = {
    restoreSession: async () => {
      throw new Error(
        'POST https://example.supabase.co/auth/v1/token?token=LOCAL-SECRET failed',
      );
    },
    signIn: async () => session('local'),
    signUp: async () => session('local'),
    signOut: async () => undefined,
  };
  let latest: ReturnType<typeof useAuthSession> | null = null;

  render(
    <Probe
      client={client}
      onSnapshot={(value) => { latest = value; }}
    />,
  );

  await waitFor(() => {
    expect(latest?.loading).toBe(false);
    expect(latest?.message).toBe('Authentication failed');
  });
  const errorSnapshot = latest as ReturnType<typeof useAuthSession> | null;
  expect(errorSnapshot?.message).not.toContain('LOCAL-SECRET');
  expect(errorSnapshot?.message).not.toContain('supabase.co');
});

test('external sign out invalidates an older in-flight local sign in', async () => {
  const signIn = deferred<AuthSession>();
  let listener: ((identity: AuthIdentity | null) => void) | null = null;
  const client: AuthClient = {
    restoreSession: async () => null,
    signIn: async () => signIn.promise,
    signUp: async () => null,
    signOut: async () => undefined,
    subscribe: (next) => {
      listener = next;
      return () => undefined;
    },
  };
  let latest: ReturnType<typeof useAuthSession> | null = null;
  render(
    <Probe
      client={client}
      onSnapshot={(value) => { latest = value; }}
    />,
  );

  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  let signingIn!: Promise<void>;
  act(() => {
    signingIn = latest!.signIn(
      'user@example.com',
      'secret12',
    );
  });

  await act(async () => {
    listener?.(null);
    await Promise.resolve();
  });
  expect(screen.getByTestId('auth-state').props.children)
    .toBe('guest:ready');

  await act(async () => {
    signIn.resolve(session('stale-local-user'));
    await signingIn;
  });

  expect(screen.getByTestId('auth-state').props.children)
    .toBe('guest:ready');
});

test('a replacement backend never receives the previous backend identity while restoring', async () => {
  const restore = deferred<AuthSession | null>();
  const first: AuthClient = {
    restoreSession: async () => session('previous-account'),
    signIn: async () => session('previous-account'),
    signUp: async () => null,
    signOut: async () => undefined,
  };
  const second: AuthClient = { ...first, restoreSession: () => restore.promise };
  const firstSnapshot = jest.fn();
  const secondSnapshot = jest.fn();
  const view = render(<Probe client={first} onSnapshot={firstSnapshot} />);
  await waitFor(() => {
    expect(screen.getByTestId('auth-state').props.children).toBe('previous-account:ready');
  });

  view.rerender(<Probe client={second} onSnapshot={secondSnapshot} />);

  expect(screen.getByTestId('auth-state').props.children).toBe('guest:loading');
  expect(secondSnapshot.mock.calls.every(([value]) => value.session === null)).toBe(true);

  await act(async () => {
    restore.resolve(session('new-account'));
    await restore.promise;
  });
  expect(screen.getByTestId('auth-state').props.children).toBe('new-account:ready');
});

test('failed replacement backend restore does not retain the previous account', async () => {
  const first: AuthClient = {
    restoreSession: async () => session('previous-account'),
    signIn: async () => session('previous-account'),
    signUp: async () => null,
    signOut: async () => undefined,
  };
  const second: AuthClient = {
    ...first,
    restoreSession: async () => { throw new Error('Backend unavailable'); },
  };
  let latest: ReturnType<typeof useAuthSession> | undefined;
  const onSnapshot = (value: ReturnType<typeof useAuthSession>) => { latest = value; };
  const view = render(<Probe client={first} onSnapshot={onSnapshot} />);
  await waitFor(() => expect(latest?.session?.userId).toBe('previous-account'));

  view.rerender(<Probe client={second} onSnapshot={onSnapshot} />);

  await waitFor(() => expect(latest?.message).toBe('Backend unavailable'));
  expect(latest?.session).toBeNull();
  expect(latest?.loading).toBe(false);
});
