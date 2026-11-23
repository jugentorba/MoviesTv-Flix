import {
  fetchTmdbJson,
  TmdbUpstreamError,
} from '../../../../../supabase/functions/catalog/tmdb';

function response(
  body: string,
  options: {
    ok?: boolean;
    status?: number;
    contentType?: string | null;
    contentLength?: string | null;
    text?: () => Promise<string>;
  } = {},
) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') {
          return options.contentType ?? 'application/json';
        }
        if (name.toLowerCase() === 'content-length') {
          return options.contentLength ?? null;
        }
        return null;
      },
    },
    text: options.text ?? (async () => body),
  } as unknown as Response;
}

test('TMDB requests stay bounded and keep bearer credentials in headers', async () => {
  const fetcher = jest.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response('{"results":[]}'));

  await expect(fetchTmdbJson(
    '/search/movie',
    'LOCAL-TMDB-TOKEN',
    { query: 'Dune', page: 2 },
    fetcher,
    1000,
    1024,
  )).resolves.toEqual({ results: [] });

  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toContain('/search/movie?');
  expect(String(url)).toContain('query=Dune');
  expect(String(url)).toContain('page=2');
  expect(init).toEqual(expect.objectContaining({
    method: 'GET',
    headers: {
      accept: 'application/json',
      Authorization: 'Bearer LOCAL-TMDB-TOKEN',
    },
    signal: expect.anything(),
  }));
});

test('TMDB loader rejects malformed and oversized declared lengths', async () => {
  for (const contentLength of ['-1', '1e3', '12.5', 'not-a-number']) {
    await expect(fetchTmdbJson(
      '/movie/1',
      'token',
      {},
      async () => response('{}', { contentLength }),
      1000,
      1024,
    )).rejects.toMatchObject({
      message: 'TMDB response has invalid content length',
      status: 502,
    });
  }

  await expect(fetchTmdbJson(
    '/movie/1',
    'token',
    {},
    async () => response('{}', { contentLength: '1025' }),
    1000,
    1024,
  )).rejects.toMatchObject({
    message: 'TMDB response is too large',
    status: 502,
  });
});

test('TMDB loader rejects oversized, HTML, and malformed JSON bodies', async () => {
  await expect(fetchTmdbJson(
    '/movie/1',
    'token',
    {},
    async () => response(JSON.stringify({ payload: 'x'.repeat(200) })),
    1000,
    100,
  )).rejects.toMatchObject({
    message: 'TMDB response is too large',
    status: 502,
  });

  await expect(fetchTmdbJson(
    '/movie/1',
    'token',
    {},
    async () => response('<html>error</html>', { contentType: 'text/html' }),
    1000,
    1024,
  )).rejects.toMatchObject({
    message: 'TMDB response is HTML, not JSON',
    status: 502,
  });

  await expect(fetchTmdbJson(
    '/movie/1',
    'token',
    {},
    async () => response('{broken'),
    1000,
    1024,
  )).rejects.toMatchObject({
    message: 'TMDB returned invalid JSON',
    status: 502,
  });
});

test('TMDB timeout also bounds a stalled response body', async () => {
  jest.useFakeTimers();
  try {
    const pending = fetchTmdbJson(
      '/movie/1',
      'token',
      {},
      async () => response('', {
        text: () => new Promise<string>(() => undefined),
      }),
      50,
      1024,
    );
    await Promise.resolve();
    jest.advanceTimersByTime(51);

    await expect(pending).rejects.toEqual(expect.objectContaining({
      name: 'TmdbUpstreamError',
      message: 'TMDB request timed out',
      status: 504,
      retryable: true,
    }));
  } finally {
    jest.useRealTimers();
  }
});

test('TMDB loader preserves upstream HTTP status and retryability', async () => {
  await expect(fetchTmdbJson(
    '/movie/1',
    'token',
    {},
    async () => response('', { ok: false, status: 429 }),
    1000,
    1024,
  )).rejects.toEqual(expect.objectContaining<TmdbUpstreamError>({
    name: 'TmdbUpstreamError',
    message: 'TMDB request failed (429)',
    status: 429,
    retryable: true,
  }));
});
