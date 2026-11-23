import { fetchBoundedJson, type HttpFetcher } from '../HttpJsonLoader';

test('provider JSON requests follow redirects for browser/PWA playback', async () => {
  const fetcher = jest.fn(async (_url: string, _init: Parameters<HttpFetcher>[1]) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => JSON.stringify({ streams: [] }),
  }));

  await expect(fetchBoundedJson(fetcher, 'https://provider.example/stream/movie/tt1.json'))
    .resolves.toEqual({ streams: [] });

  expect(fetcher).toHaveBeenCalledWith(
    'https://provider.example/stream/movie/tt1.json',
    expect.objectContaining({
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
    }),
  );
});


function response(
  body: string,
  options: {
    length?: string | null;
    url?: string;
  } = {},
) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    ...(options.url ? { url: options.url } : {}),
    headers: {
      get: (name: string) => (
        name.toLowerCase() === 'content-length'
          ? (options.length ?? null)
          : null
      ),
    },
    text: async () => body,
  };
}

test('reads chunked provider JSON without requiring Content-Length', async () => {
  const bytes = Buffer.from(JSON.stringify({ title: 'Café' }), 'utf8');
  const chunks = [
    new Uint8Array(bytes.subarray(0, bytes.length - 2)),
    new Uint8Array(bytes.subarray(bytes.length - 2)),
  ];
  let index = 0;

  const fetcher = jest.fn(async () => ({
    ...response('should-not-use-text'),
    body: {
      getReader: () => ({
        read: async () => (
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true }
        ),
        cancel: jest.fn(),
      }),
    },
    text: async () => {
      throw new Error('streaming path should not call text()');
    },
  }));

  await expect(fetchBoundedJson(
    fetcher,
    'https://provider.example/catalog.json',
    1000,
    1024,
  )).resolves.toEqual({ title: 'Café' });
});

test('cancels an oversized chunked provider body before materializing it', async () => {
  const cancel = jest.fn(async () => undefined);
  let index = 0;
  const chunks = [
    new Uint8Array(Buffer.from('12345')),
    new Uint8Array(Buffer.from('678901')),
  ];
  const fetcher = jest.fn(async () => ({
    ...response('should-not-use-text'),
    body: {
      getReader: () => ({
        read: async () => (
          index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true }
        ),
        cancel,
      }),
    },
    text: async () => {
      throw new Error('streaming path should not call text()');
    },
  }));

  await expect(fetchBoundedJson(
    fetcher,
    'https://provider.example/catalog.json',
    1000,
    10,
  )).rejects.toThrow('Provider response is too large');
  expect(cancel).toHaveBeenCalled();
});

test('keeps provider timeout active while the response body is read', async () => {
  const fetcher = jest.fn(async () => ({
    ...response('{}'),
    text: () => new Promise<string>(() => undefined),
  }));

  const outcome = await Promise.race([
    fetchBoundedJson(
      fetcher,
      'https://provider.example/manifest.json',
      2,
      1024,
    ).then(
      () => 'resolved',
      (cause) => cause instanceof Error ? cause.message : 'rejected',
    ),
    new Promise<string>((resolve) => {
      setTimeout(() => resolve('still pending'), 30);
    }),
  ]);

  expect(outcome).toBe('Provider request timed out');
});

test('cancels a stalled streamed provider body when the timeout expires', async () => {
  jest.useFakeTimers();
  try {
    const cancel = jest.fn(async () => undefined);
    const fetcher = jest.fn(async () => ({
      ...response('should-not-use-text'),
      body: {
        getReader: () => ({
          read: () => new Promise<never>(() => undefined),
          cancel,
        }),
      },
      text: async () => {
        throw new Error('streaming path should not call text()');
      },
    }));

    const pending = fetchBoundedJson(
      fetcher,
      'https://provider.example/manifest.json',
      50,
      1024,
    );
    const rejection = expect(pending).rejects.toThrow(
      'Provider request timed out',
    );

    await jest.advanceTimersByTimeAsync(51);

    await rejection;
    expect(cancel).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('rejects invalid loading limits before making a provider request', async () => {
  const fetcher = jest.fn();

  await expect(
    fetchBoundedJson(
      fetcher as any,
      'https://provider.example/manifest.json',
      0,
      1024,
    ),
  ).rejects.toThrow('Invalid provider loading limits');

  await expect(
    fetchBoundedJson(
      fetcher as any,
      'https://provider.example/manifest.json',
      1000,
      0,
    ),
  ).rejects.toThrow('Invalid provider loading limits');

  expect(fetcher).not.toHaveBeenCalled();
});

test('rejects malformed declared content lengths', async () => {
  for (const length of ['-1', '1e3', '12.5', 'not-a-number']) {
    const fetcher = jest.fn(async () => response('{}', { length }));

    await expect(
      fetchBoundedJson(
        fetcher,
        'https://provider.example/manifest.json',
        1000,
        1024,
      ),
    ).rejects.toThrow('invalid content length');
  }
});


test('validates provider request URLs before fetching', async () => {
  const fetcher = jest.fn(async () => response('{}'));

  await expect(fetchBoundedJson(
    fetcher as any,
    'http://provider.example/manifest.json',
  )).rejects.toThrow('HTTPS');

  await expect(fetchBoundedJson(
    fetcher as any,
    'https://user:pass@provider.example/manifest.json',
  )).rejects.toThrow('credentials');

  await expect(fetchBoundedJson(
    fetcher as any,
    `https://provider.example/${'x'.repeat(16_500)}`,
  )).rejects.toThrow('URL');

  expect(fetcher).not.toHaveBeenCalled();
});

test('allows HTTP only for manual loopback provider development', async () => {
  const fetcher = jest.fn(async () => response('{"ok":true}'));

  await expect(fetchBoundedJson(
    fetcher,
    'http://127.0.0.1:7000/manifest.json',
  )).resolves.toEqual({ ok: true });

  expect(fetcher).toHaveBeenCalledWith(
    'http://127.0.0.1:7000/manifest.json',
    expect.objectContaining({ method: 'GET' }),
  );
});

test('rejects insecure non-loopback provider redirects', async () => {
  const publicHttp = jest.fn(async () => response('{}', {
    url: 'http://provider.example/manifest.json',
  }));
  await expect(fetchBoundedJson(
    publicHttp,
    'http://127.0.0.1:7000/manifest.json',
  )).rejects.toThrow('redirect');

  const downgrade = jest.fn(async () => response('{}', {
    url: 'http://127.0.0.1:7000/manifest.json',
  }));
  await expect(fetchBoundedJson(
    downgrade,
    'https://provider.example/manifest.json',
  )).rejects.toThrow('redirect');
});
