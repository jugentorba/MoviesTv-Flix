import React from 'react';
import { render, screen } from '@testing-library/react-native';
import appConfig from '../../app.config';
import {
  fetchRuntimeSupabaseConfig,
  readSupabaseConfig,
  shouldFetchRuntimeSupabaseConfig,
  shouldLoadStoredSupabaseConfig,
} from '../services/runtime';
import AppRoot, { enqueueRuntimeConfigStorageMutation } from '../app/AppRoot';

jest.mock('../playback/PlaybackOverlay', () => ({
  PlaybackOverlay: () => null,
}));

jest.mock('../navigation/AppNavigator', () => {
  const ReactModule = require('react');
  const { Text } = require('react-native');
  return {
    AppNavigator: () => ReactModule.createElement(Text, null, 'guest-app'),
  };
});

function runtimeResponse(
  payload: unknown,
  options: {
    ok?: boolean;
    body?: string;
    contentType?: string | null;
    contentLength?: string | null;
    text?: () => Promise<string>;
  } = {},
) {
  const body = options.body ?? JSON.stringify(payload);
  return {
    ok: options.ok ?? true,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') {
          return options.contentType === undefined
            ? 'application/json'
            : options.contentType;
        }
        if (name.toLowerCase() === 'content-length') {
          return options.contentLength ?? null;
        }
        return null;
      },
    },
    text: options.text ?? (async () => body),
  };
}

test('declares the stable iOS application identity', () => {
  expect(appConfig.expo.ios).toEqual(
    expect.objectContaining({
      bundleIdentifier: 'com.jugentorba.moviestvflix',
      supportsTablet: true,
    }),
  );
});

test('native previews can load saved public account configuration without a web runtime endpoint', () => {
  expect(shouldLoadStoredSupabaseConfig(false, false)).toBe(true);
  expect(shouldFetchRuntimeSupabaseConfig(
    'ios',
    false,
    false,
  )).toBe(false);
  expect(shouldFetchRuntimeSupabaseConfig(
    'android',
    false,
    false,
  )).toBe(false);
  expect(shouldFetchRuntimeSupabaseConfig(
    'web',
    false,
    false,
  )).toBe(true);

  expect(shouldLoadStoredSupabaseConfig(true, false)).toBe(false);
  expect(shouldLoadStoredSupabaseConfig(false, true)).toBe(false);
});

test('reports a typed condition when Supabase configuration is absent', () => {
  expect(readSupabaseConfig({})).toEqual({ ok: false, reason: 'backend-not-configured' });
});

test('application startup stays usable as a guest when backend configuration is absent', async () => {
  render(<AppRoot environment={{}} />);
  expect(await screen.findByText('guest-app')).toBeTruthy();
  expect(screen.queryByText('Connect the backend to sign in')).toBeNull();
});


test('loads public Supabase configuration from the runtime endpoint', async () => {
  const fetcher = jest.fn(async () => runtimeResponse({
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: 'sb_publishable_fixture12345678',
  }));

  await expect(fetchRuntimeSupabaseConfig(fetcher)).resolves.toEqual({
    ok: true,
    url: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_fixture12345678',
  });
  expect(fetcher).toHaveBeenCalledWith(
    '/api/runtime-config',
    expect.objectContaining({ method: 'GET' }),
  );
});

test('runtime config failure falls back to typed guest mode', async () => {
  const unavailable = jest.fn(async () => runtimeResponse({}, { ok: false }));
  const malformed = jest.fn(async () => runtimeResponse({
    supabaseUrl: 'https://example.supabase.co',
  }));

  await expect(fetchRuntimeSupabaseConfig(unavailable)).resolves.toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });
  await expect(fetchRuntimeSupabaseConfig(malformed)).resolves.toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });
});


test('rejects unsafe Supabase client configuration', () => {
  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'http://evil.example/project',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
  })).toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });

  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co?token=leak',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
  })).toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });

  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never-public',
  })).toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });
});

test('rejects arbitrary remote backend keys and accepts modern publishable keys', () => {
  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
  })).toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });

  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      'sb_publishable_fixture12345678',
  })).toEqual({
    ok: true,
    url: 'https://example.supabase.co',
    publishableKey: 'sb_publishable_fixture12345678',
  });
});

test('rejects a legacy JWT carrying the Supabase service-role claim', () => {
  const encode = (value: object) => (
    Buffer.from(JSON.stringify(value)).toString('base64url')
  );
  const serviceRoleJwt = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ role: 'service_role' }),
    'signature',
  ].join('.');

  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: serviceRoleJwt,
  })).toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });
});

test('rejects legacy JWT client keys with non-anon roles', () => {
  const encode = (value: object) => (
    Buffer.from(JSON.stringify(value)).toString('base64url')
  );
  const privilegedJwt = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ role: 'supabase_admin' }),
    'signature',
  ].join('.');
  const anonJwt = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ role: 'anon' }),
    'signature',
  ].join('.');

  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: privilegedJwt,
  })).toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });
  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: anonJwt,
  })).toEqual({
    ok: true,
    url: 'https://example.supabase.co',
    publishableKey: anonJwt,
  });
});

test('rejects a service-role JWT even when atob is unavailable', () => {
  const encode = (value: object) => (
    Buffer.from(JSON.stringify(value)).toString('base64url')
  );
  const serviceRoleJwt = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ role: 'service_role' }),
    'signature',
  ].join('.');
  const originalAtob = globalThis.atob;

  try {
    Object.defineProperty(globalThis, 'atob', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    expect(readSupabaseConfig({
      EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: serviceRoleJwt,
    })).toEqual({
      ok: false,
      reason: 'backend-not-configured',
    });
  } finally {
    Object.defineProperty(globalThis, 'atob', {
      configurable: true,
      writable: true,
      value: originalAtob,
    });
  }
});

test('allows localhost HTTP only for local Supabase development', () => {
  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-public-key',
  })).toEqual({
    ok: true,
    url: 'http://127.0.0.1:54321',
    publishableKey: 'local-public-key',
  });

  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'http://[::1]:54321',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-public-key',
  })).toEqual({
    ok: true,
    url: 'http://[::1]:54321',
    publishableKey: 'local-public-key',
  });
});


test('runtime config rejects malformed, HTML, and oversized bodies', async () => {
  for (const contentLength of ['-1', '1e3', '12.5', 'not-a-number']) {
    const fetcher = jest.fn(async () => runtimeResponse({}, { contentLength }));
    await expect(fetchRuntimeSupabaseConfig(fetcher)).resolves.toEqual({
      ok: false,
      reason: 'backend-not-configured',
    });
  }

  await expect(fetchRuntimeSupabaseConfig(
    jest.fn(async () => runtimeResponse({}, {
      contentType: 'text/html; charset=utf-8',
      body: '<html>bad gateway</html>',
    })),
  )).resolves.toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });

  await expect(fetchRuntimeSupabaseConfig(
    jest.fn(async () => runtimeResponse({}, {
      contentLength: '20000',
    })),
  )).resolves.toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });

  await expect(fetchRuntimeSupabaseConfig(
    jest.fn(async () => runtimeResponse({}, {
      body: JSON.stringify({ payload: 'x'.repeat(20_000) }),
    })),
  )).resolves.toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });

  await expect(fetchRuntimeSupabaseConfig(
    jest.fn(async () => runtimeResponse({}, {
      body: '{broken',
    })),
  )).resolves.toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });
});

test('runtime backend discovery times out instead of loading forever', async () => {
  jest.useFakeTimers();
  try {
    let signal: AbortSignal | undefined;
    const fetcher = jest.fn((_input: string, init?: { signal?: AbortSignal }) => {
      signal = init?.signal;
      return new Promise<never>(() => undefined);
    });

    const pending = fetchRuntimeSupabaseConfig(
      fetcher,
      '/api/runtime-config',
      50,
    );
    await jest.advanceTimersByTimeAsync(51);

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'backend-not-configured',
    });
    expect(signal?.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});


test('runtime backend timeout also bounds a stalled response body', async () => {
  jest.useFakeTimers();
  try {
    const fetcher = jest.fn(async () => runtimeResponse({}, {
      text: () => new Promise<never>(() => undefined),
    }));

    const pending = fetchRuntimeSupabaseConfig(
      fetcher,
      '/api/runtime-config',
      50,
    );
    let settled = false;
    void pending.finally(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(51);
    await Promise.resolve();

    expect(settled).toBe(true);
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: 'backend-not-configured',
    });
  } finally {
    jest.useRealTimers();
  }
});


test('rejects unbounded or control-character public backend configuration', () => {
  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL:
      `https://example.supabase.co/${'x'.repeat(2_050)}`,
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key',
  })).toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });

  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'x'.repeat(8_193),
  })).toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });

  expect(readSupabaseConfig({
    EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'public-key\nsecond-line',
  })).toEqual({
    ok: false,
    reason: 'backend-not-configured',
  });
});


test('runtime backend storage mutations preserve configure-reset-configure order', async () => {
  const queueRef = { current: Promise.resolve() };
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    markFirstStarted = resolve;
  });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let stored: string | null = null;
  const events: string[] = [];

  const firstConfigure = enqueueRuntimeConfigStorageMutation(
    queueRef,
    async () => {
      events.push('configure-a:start');
      markFirstStarted();
      await firstGate;
      stored = 'backend-a';
      events.push('configure-a:end');
    },
  );
  const reset = enqueueRuntimeConfigStorageMutation(
    queueRef,
    async () => {
      events.push('reset');
      stored = null;
    },
  );
  const secondConfigure = enqueueRuntimeConfigStorageMutation(
    queueRef,
    async () => {
      events.push('configure-b');
      stored = 'backend-b';
    },
  );

  await firstStarted;
  expect(events).toEqual(['configure-a:start']);

  releaseFirst();
  await Promise.all([firstConfigure, reset, secondConfigure]);

  expect(events).toEqual([
    'configure-a:start',
    'configure-a:end',
    'reset',
    'configure-b',
  ]);
  expect(stored).toBe('backend-b');
});
