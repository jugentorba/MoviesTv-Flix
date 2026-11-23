export {};

function loadModule(path: string): Record<string, unknown> {
  try {
    return require(path) as Record<string, unknown>;
  } catch {
    return {};
  }
}


function remoteResponse(body: unknown) {
  const serialized = JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') {
          return 'application/json';
        }
        if (name.toLowerCase() === 'content-length') {
          return String(Buffer.byteLength(serialized));
        }
        return null;
      },
    },
    text: async () => serialized,
    json: async () => body,
  };
}

function rawRemoteResponse(
  body: string,
  options: {
    status?: number;
    statusText?: string;
    contentType?: string | null;
    contentLength?: string | null;
    text?: () => Promise<string>;
  } = {},
) {
  const status = options.status ?? 200;
  const contentType = options.contentType === undefined
    ? 'application/json'
    : options.contentType;
  const contentLength = options.contentLength === undefined
    ? null
    : options.contentLength;

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: options.statusText ?? '',
    headers: {
      get(name: string) {
        const normalized = name.toLowerCase();
        if (normalized === 'content-type') return contentType;
        if (normalized === 'content-length') return contentLength;
        return null;
      },
    },
    text: options.text ?? (async () => body),
  };
}

describe('catalog gateway configuration', () => {
  it('starts without a bundled catalog when no remote catalog is configured', () => {
    const mod = loadModule('../catalog-config');
    const getCatalogConfig = mod.getCatalogConfig as undefined | ((env: Record<string, string | undefined>) => unknown);
    expect(getCatalogConfig).toBeDefined();
    expect(getCatalogConfig?.({})).toEqual({ mode: 'installed', baseUrl: null });
  });

  it('keeps the catalog user-installed-only in preview mode', () => {
    const mod = loadModule('../catalog-config');
    const getCatalogConfig = mod.getCatalogConfig as undefined | ((env: Record<string, string | undefined>) => unknown);
    expect(getCatalogConfig).toBeDefined();
    expect(getCatalogConfig?.({ EXPO_PUBLIC_PREVIEW_MODE: '1' })).toEqual({
      mode: 'installed',
      baseUrl: null,
    });
  });

  it('uses demo catalog only when explicitly requested', () => {
    const mod = loadModule('../catalog-config');
    const getCatalogConfig = mod.getCatalogConfig as undefined | ((env: Record<string, string | undefined>) => unknown);
    expect(getCatalogConfig?.({ EXPO_PUBLIC_DEMO_CATALOG: '1' })).toEqual({
      mode: 'demo',
      baseUrl: null,
    });
  });

  it('normalizes a configured remote catalog base URL', () => {
    const mod = loadModule('../catalog-config');
    const getCatalogConfig = mod.getCatalogConfig as undefined | ((env: Record<string, string | undefined>) => unknown);
    expect(getCatalogConfig).toBeDefined();
    expect(getCatalogConfig?.({ EXPO_PUBLIC_CATALOG_BASE_URL: ' https://catalog.example.com/ ' })).toEqual({
      mode: 'remote',
      baseUrl: 'https://catalog.example.com',
    });
  });

  it('rejects unsafe remote catalog URLs and falls back to user-installed catalogs only', () => {
    const mod = loadModule('../catalog-config');
    const getCatalogConfig = mod.getCatalogConfig as undefined | (
      (env: Record<string, string | undefined>) => unknown
    );
    expect(getCatalogConfig).toBeDefined();

    for (const value of [
      'http://catalog.example.com',
      'javascript:alert(1)',
      'https://user:pass@catalog.example.com',
      'https://catalog.example.com/path?token=secret',
      `https://catalog.example.com/${'x'.repeat(2_100)}`,
      'https://catalog.example.com/\u0000bad',
    ]) {
      expect(getCatalogConfig?.({
        EXPO_PUBLIC_CATALOG_BASE_URL: value,
      })).toEqual({
        mode: 'installed',
        baseUrl: null,
      });
    }
  });

  it('allows localhost HTTP for remote catalog development', () => {
    const mod = loadModule('../catalog-config');
    const getCatalogConfig = mod.getCatalogConfig as undefined | (
      (env: Record<string, string | undefined>) => unknown
    );

    expect(getCatalogConfig?.({
      EXPO_PUBLIC_CATALOG_BASE_URL: 'http://127.0.0.1:54321/catalog/',
    })).toEqual({
      mode: 'remote',
      baseUrl: 'http://127.0.0.1:54321/catalog',
    });

    expect(getCatalogConfig?.({
      EXPO_PUBLIC_CATALOG_BASE_URL: 'http://[::1]:54321/catalog/',
    })).toEqual({
      mode: 'remote',
      baseUrl: 'http://[::1]:54321/catalog',
    });
  });

});

describe('DemoCatalogGateway', () => {
  it('exposes home, movies and series sections', async () => {
    const mod = loadModule('../DemoCatalogGateway');
    const DemoCatalogGateway = mod.DemoCatalogGateway as undefined | (new () => any);
    expect(DemoCatalogGateway).toBeDefined();
    const gateway = new DemoCatalogGateway!();
    await expect(gateway.getSections()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'home:trending-movies' }),
      expect.objectContaining({ id: 'movies:popular' }),
      expect.objectContaining({ id: 'series:popular' }),
    ]));
  });

  it('searches movies and series case-insensitively', async () => {
    const mod = loadModule('../DemoCatalogGateway');
    const DemoCatalogGateway = mod.DemoCatalogGateway as undefined | (new () => any);
    expect(DemoCatalogGateway).toBeDefined();
    const gateway = new DemoCatalogGateway!();
    const page = await gateway.search('orbit');
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Orbit City', kind: 'movie' }),
      expect.objectContaining({ title: 'Beyond Orbit', kind: 'series' }),
    ]));
  });

  it('returns normalized details by canonical media ID', async () => {
    const mod = loadModule('../DemoCatalogGateway');
    const DemoCatalogGateway = mod.DemoCatalogGateway as undefined | (new () => any);
    expect(DemoCatalogGateway).toBeDefined();
    const gateway = new DemoCatalogGateway!();
    await expect(gateway.getDetails('demo:movie:orbit-city')).resolves.toEqual(
      expect.objectContaining({
        id: 'demo:movie:orbit-city',
        title: 'Orbit City',
        providerId: 'demo',
        externalIds: {},
      }),
    );
  });

  it('returns deterministic real episode fixtures for a demo series season', async () => {
    const mod = loadModule('../DemoCatalogGateway');
    const DemoCatalogGateway = mod.DemoCatalogGateway as undefined | (new () => any);
    expect(DemoCatalogGateway).toBeDefined();
    const gateway = new DemoCatalogGateway!();

    await expect(gateway.getSeason('demo:series:beyond-orbit', 1)).resolves.toEqual({
      seriesId: 'demo:series:beyond-orbit',
      seasonNumber: 1,
      name: 'Season 1',
      episodes: [
        expect.objectContaining({
          id: 'demo:episode:beyond-orbit:1:1',
          seriesId: 'demo:series:beyond-orbit',
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'First Contact',
        }),
        expect.objectContaining({
          id: 'demo:episode:beyond-orbit:1:2',
          episodeNumber: 2,
          title: 'Echo Line',
        }),
      ],
    });
    await expect(gateway.getSeason('demo:series:missing', 1)).resolves.toBeNull();
  });
});

describe('RemoteCatalogGateway', () => {
  it('posts allowlisted catalog actions to the configured endpoint', async () => {
    const mod = loadModule('../RemoteCatalogGateway');
    const RemoteCatalogGateway = mod.RemoteCatalogGateway as undefined | (new (baseUrl: string, fetcher: any) => any);
    expect(RemoteCatalogGateway).toBeDefined();
    const fetcher = jest.fn(async (_url: string, _init: RequestInit) => (
      remoteResponse({ items: [] })
    ));
    const gateway = new RemoteCatalogGateway!('https://catalog.example.com', fetcher);

    await expect(gateway.search('Dune')).resolves.toEqual({ items: [] });
    expect(fetcher).toHaveBeenCalledWith('https://catalog.example.com', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'search', query: 'Dune' }),
      signal: expect.anything(),
    }));
  });

  it('posts a season request with the canonical series ID and season number', async () => {
    const mod = loadModule('../RemoteCatalogGateway');
    const RemoteCatalogGateway = mod.RemoteCatalogGateway as undefined | (new (baseUrl: string, fetcher: any) => any);
    expect(RemoteCatalogGateway).toBeDefined();
    const response = { seriesId: 'tmdb:series:1399', seasonNumber: 2, episodes: [] };
    const fetcher = jest.fn(async (_url: string, _init: RequestInit) => (
      remoteResponse(response)
    ));
    const gateway = new RemoteCatalogGateway!('https://catalog.example.com', fetcher);

    await expect(gateway.getSeason('tmdb:series:1399', 2)).resolves.toEqual(response);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      action: 'season',
      mediaId: 'tmdb:series:1399',
      seasonNumber: 2,
    });
  });

  it('rejects non-successful remote catalog responses', async () => {
    const mod = loadModule('../RemoteCatalogGateway');
    const RemoteCatalogGateway = mod.RemoteCatalogGateway as undefined | (
      new (baseUrl: string, fetcher: any) => any
    );
    const fetcher = jest.fn(async () => rawRemoteResponse('', {
      status: 503,
      statusText: 'Service Unavailable',
    }));
    const gateway = new RemoteCatalogGateway!('https://catalog.example.com', fetcher);

    await expect(gateway.getSections()).rejects.toThrow(
      'Catalog request failed (503 Service Unavailable)',
    );
  });

  it('rejects HTML and malformed JSON catalog responses', async () => {
    const mod = loadModule('../RemoteCatalogGateway');
    const RemoteCatalogGateway = mod.RemoteCatalogGateway as undefined | (
      new (baseUrl: string, fetcher: any) => any
    );

    const htmlGateway = new RemoteCatalogGateway!(
      'https://catalog.example.com',
      jest.fn(async () => rawRemoteResponse('<html>error</html>', {
        contentType: 'text/html; charset=utf-8',
      })),
    );
    await expect(htmlGateway.getSections()).rejects.toThrow(
      'Catalog response is HTML, not JSON',
    );

    const invalidGateway = new RemoteCatalogGateway!(
      'https://catalog.example.com',
      jest.fn(async () => rawRemoteResponse('{broken')),
    );
    await expect(invalidGateway.getSections()).rejects.toThrow(
      'Catalog returned invalid JSON',
    );
  });

  it('rejects malformed content-length headers instead of coercing them', async () => {
    const mod = loadModule('../RemoteCatalogGateway');
    const RemoteCatalogGateway = mod.RemoteCatalogGateway as undefined | (
      new (
        baseUrl: string,
        fetcher: any,
        timeoutMs?: number,
        maxBytes?: number,
      ) => any
    );

    for (const contentLength of ['1e3', '-1', '12.5', 'not-a-number']) {
      const gateway = new RemoteCatalogGateway!(
        'https://catalog.example.com',
        jest.fn(async () => rawRemoteResponse('{}', { contentLength })),
      );

      await expect(gateway.getSections()).rejects.toThrow(
        'Catalog response has invalid content length',
      );
    }
  });

  it('rejects declared and actual catalog bodies above the configured limit', async () => {
    const mod = loadModule('../RemoteCatalogGateway');
    const RemoteCatalogGateway = mod.RemoteCatalogGateway as undefined | (
      new (
        baseUrl: string,
        fetcher: any,
        timeoutMs?: number,
        maxBytes?: number,
      ) => any
    );

    const declaredGateway = new RemoteCatalogGateway!(
      'https://catalog.example.com',
      jest.fn(async () => rawRemoteResponse('{}', {
        contentLength: '101',
      })),
      8_000,
      100,
    );
    await expect(declaredGateway.getSections()).rejects.toThrow(
      'Catalog response is too large',
    );

    const actualGateway = new RemoteCatalogGateway!(
      'https://catalog.example.com',
      jest.fn(async () => rawRemoteResponse(JSON.stringify({
        payload: 'x'.repeat(128),
      }))),
      8_000,
      100,
    );
    await expect(actualGateway.getSections()).rejects.toThrow(
      'Catalog response is too large',
    );
  });

  it('times out both a stalled remote request and a stalled response body', async () => {
    jest.useFakeTimers();
    try {
      const mod = loadModule('../RemoteCatalogGateway');
      const RemoteCatalogGateway = mod.RemoteCatalogGateway as undefined | (
        new (
          baseUrl: string,
          fetcher: any,
          timeoutMs?: number,
          maxBytes?: number,
        ) => any
      );

      const pendingFetch = new RemoteCatalogGateway!(
        'https://catalog.example.com',
        jest.fn(() => new Promise(() => undefined)),
        50,
      ).getSections();
      jest.advanceTimersByTime(51);
      await expect(pendingFetch).rejects.toThrow('Catalog request timed out');

      const pendingBody = new RemoteCatalogGateway!(
        'https://catalog.example.com',
        jest.fn(async () => rawRemoteResponse('', {
          text: () => new Promise(() => undefined),
        })),
        50,
      ).getSections();
      await Promise.resolve();
      jest.advanceTimersByTime(51);
      await expect(pendingBody).rejects.toThrow('Catalog request timed out');
    } finally {
      jest.useRealTimers();
    }
  });

  it('honors a shorter CatalogService budget and aborts the remote fetch', async () => {
    jest.useFakeTimers();
    try {
      const mod = loadModule('../RemoteCatalogGateway');
      const RemoteCatalogGateway = mod.RemoteCatalogGateway as undefined | (
        new (
          baseUrl: string,
          fetcher: any,
          timeoutMs?: number,
          maxBytes?: number,
        ) => any
      );
      let signal: AbortSignal | undefined;
      const fetcher = jest.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise(() => undefined);
      });
      const gateway = new RemoteCatalogGateway!(
        'https://catalog.example.com',
        fetcher,
        8_000,
      );

      const pending = gateway.search(
        'Dune',
        undefined,
        { timeoutMs: 25 },
      );
      const rejection = expect(pending).rejects.toThrow(
        'Catalog request timed out',
      );
      await jest.advanceTimersByTimeAsync(26);

      await rejection;
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects invalid remote catalog loading limits before fetching', async () => {
    const mod = loadModule('../RemoteCatalogGateway');
    const RemoteCatalogGateway = mod.RemoteCatalogGateway as undefined | (
      new (
        baseUrl: string,
        fetcher: any,
        timeoutMs?: number,
        maxBytes?: number,
      ) => any
    );
    const fetcher = jest.fn(async () => remoteResponse([]));
    const gateway = new RemoteCatalogGateway!(
      'https://catalog.example.com',
      fetcher,
      0,
      100,
    );

    await expect(gateway.getSections()).rejects.toThrow(
      'Invalid remote catalog loading limits',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});


test('Nuvio PWA proxy rejects insecure or credentialed manifest URLs', () => {
  const mod = loadModule('../nuvio-proxy');
  const nuvioWebCatalogBaseUrl = mod.nuvioWebCatalogBaseUrl as
    | undefined
    | ((manifestUrl: string) => string | undefined);

  expect(nuvioWebCatalogBaseUrl?.(
    'http://catalog.nuvio.tv/manifest.json',
  )).toBeUndefined();
  expect(nuvioWebCatalogBaseUrl?.(
    'https://user:pass@catalog.nuvio.tv/manifest.json',
  )).toBeUndefined();
  expect(nuvioWebCatalogBaseUrl?.(
    'https://catalog.nuvio.tv.evil.example/manifest.json',
  )).toBeUndefined();
});

test('Nuvio PWA proxy rejects arbitrary or credential-like config paths', () => {
  const mod = loadModule('../nuvio-proxy');
  const nuvioWebCatalogBaseUrl = mod.nuvioWebCatalogBaseUrl as
    | undefined
    | ((manifestUrl: string) => string | undefined);

  for (const manifestUrl of [
    'https://catalog.nuvio.tv/not-json/manifest.json',
    'https://catalog.nuvio.tv/%7B%22token%22%3A%22secret%22%7D/manifest.json',
    'https://catalog.nuvio.tv/%7B%22language%22%3A%22token%3Dsecret%22%7D/manifest.json',
    'https://catalog.nuvio.tv/%7B%22region%22%3A%22FRANCE%22%7D/manifest.json',
    'https://catalog.nuvio.tv/%5B%22fr-FR%22%5D/manifest.json',
    'https://catalog.nuvio.tv/%7B%22language%22%3A%22fr-FR%22%7D/extra/manifest.json',
    'https://catalog.nuvio.tv/manifest.json?token=secret',
    'https://catalog.nuvio.tv/manifest.json#configured',
  ]) {
    expect(nuvioWebCatalogBaseUrl?.(manifestUrl)).toBeUndefined();
  }
});

test('Nuvio PWA proxy preserves standard configured manifest path segments', () => {
  const mod = loadModule('../nuvio-proxy');
  const nuvioWebCatalogBaseUrl = mod.nuvioWebCatalogBaseUrl as
    | undefined
    | ((manifestUrl: string) => string | undefined);

  expect(nuvioWebCatalogBaseUrl).toBeDefined();
  expect(
    nuvioWebCatalogBaseUrl?.('https://catalog.nuvio.tv/manifest.json'),
  ).toBe('/api/nuvio-catalog');

  const configured =
    'https://catalog.nuvio.tv/%7B%22language%22%3A%22fr-FR%22%2C%22region%22%3A%22FR%22%7D/manifest.json';

  expect(nuvioWebCatalogBaseUrl?.(configured)).toBe(
    '/api/nuvio-catalog/%7B%22language%22%3A%22fr-FR%22%2C%22region%22%3A%22FR%22%7D',
  );
});
