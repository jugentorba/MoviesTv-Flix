import {
  fetchBoundedCatalogJson,
  type CatalogFetcher,
} from '../CatalogJsonLoader';

function response(
  body: string,
  options: {
    length?: string | null;
    contentType?: string | null;
    url?: string;
  } = {},
) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    ...(options.url ? { url: options.url } : {}),
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-length') {
          return options.length ?? null;
        }
        if (name.toLowerCase() === 'content-type') {
          return options.contentType ?? 'application/json';
        }
        return null;
      },
    },
    text: async () => body,
  };
}

test('rejects malformed catalog content length declarations', async () => {
  for (const length of ['-1', '1e3', '12.5', 'not-a-number']) {
    const fetcher = jest.fn(async () => response('{}', { length }));

    await expect(
      fetchBoundedCatalogJson(
        fetcher as CatalogFetcher,
        'https://catalog.example/catalog.json',
        1000,
        1024,
      ),
    ).rejects.toThrow('invalid content length');
  }
});

test('accepts a normal integer catalog content length', async () => {
  const body = JSON.stringify({ metas: [] });
  const fetcher = jest.fn(async () => response(body, {
    length: String(Buffer.byteLength(body)),
  }));

  await expect(
    fetchBoundedCatalogJson(
      fetcher as CatalogFetcher,
      'https://catalog.example/catalog.json',
      1000,
      1024,
    ),
  ).resolves.toEqual({ metas: [] });
});


test('reads chunked catalog JSON without requiring Content-Length', async () => {
  const bytes = Buffer.from(JSON.stringify({ metas: [{ name: 'Café' }] }), 'utf8');
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

  await expect(
    fetchBoundedCatalogJson(
      fetcher as CatalogFetcher,
      'https://catalog.example/catalog.json',
      1000,
      1024,
    ),
  ).resolves.toEqual({ metas: [{ name: 'Café' }] });
});

test('cancels an oversized chunked catalog body early', async () => {
  const cancel = jest.fn(async () => undefined);
  const chunks = [
    new Uint8Array(Buffer.from('12345')),
    new Uint8Array(Buffer.from('678901')),
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
        cancel,
      }),
    },
    text: async () => {
      throw new Error('streaming path should not call text()');
    },
  }));

  await expect(
    fetchBoundedCatalogJson(
      fetcher as CatalogFetcher,
      'https://catalog.example/catalog.json',
      1000,
      10,
    ),
  ).rejects.toThrow('Catalog response is too large');
  expect(cancel).toHaveBeenCalled();
});

test('requests catalog JSON with no-store caching', async () => {
  const fetcher = jest.fn(async () => response('{"metas":[]}'));

  await fetchBoundedCatalogJson(
    fetcher as CatalogFetcher,
    'https://catalog.example/catalog.json',
    1000,
    1024,
  );

  expect(fetcher).toHaveBeenCalledWith(
    'https://catalog.example/catalog.json',
    expect.objectContaining({
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
    }),
  );
});
