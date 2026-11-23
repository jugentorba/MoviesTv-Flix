import type { AddonStateRecord } from '@moviestv/addons';
import { createSubtitleResolver } from '../createSubtitleResolver';

function record(
  addonId: string,
  priority: number,
  manifestUrl: string,
): AddonStateRecord {
  return {
    installed: {
      addonId,
      manifestUrl,
      sourceType: 'stremio-manifest',
      enabled: true,
      priority,
      installedAt: '2026-09-19T10:00:00.000Z',
      updatedAt: '2026-09-19T10:00:00.000Z',
      setupIncomplete: false,
    },
    safeConfig: {},
    descriptor: {
      id: addonId,
      name: addonId,
      version: '1.0.0',
      sourceType: 'stremio-manifest',
      capabilities: ['subtitle'],
      requiresConfiguration: false,
      configurationFields: [],
      supportedMediaKinds: ['movie', 'series'],
      manifestUrl,
      subtitle: {
        types: ['movie', 'series'],
        idPrefixes: ['tt'],
      },
    },
  };
}

const request = {
  mediaId: 'movie:550',
  kind: 'movie' as const,
  externalIds: { imdb: 'tt0137523', tmdb: '550' },
};

test('preferred subtitle language outranks provider priority while preserving provider order inside a language', async () => {
  const high = record('high', 200, 'https://high.example/manifest.json');
  const low = record('low', 100, 'https://low.example/manifest.json');
  const fetcher = jest.fn(async (url: string) => {
    const payload = url.startsWith('https://high.example')
      ? {
        subtitles: [
          { id: 'en-1', lang: 'en', url: 'https://cdn.example/high-en.vtt' },
          { id: 'fr-1', lang: 'fr', url: 'https://cdn.example/high-fr.vtt' },
        ],
      }
      : {
        subtitles: [
          { id: 'fr-2', lang: 'fr', url: 'https://cdn.example/low-fr.vtt' },
        ],
      };
    const body = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  const tracks = await createSubtitleResolver([low, high], fetcher).resolve(
    request,
    ['fr', 'en'],
  );

  expect(tracks.map((track) => track.url)).toEqual([
    'https://cdn.example/high-fr.vtt',
    'https://cdn.example/low-fr.vtt',
    'https://cdn.example/high-en.vtt',
  ]);
  expect(fetcher).toHaveBeenCalledWith(
    'https://high.example/subtitles/movie/tt0137523.json',
    expect.objectContaining({ method: 'GET', redirect: 'follow' }),
  );
});

test('duplicate subtitle URLs retain richer metadata across providers', async () => {
  const high = record('high', 200, 'https://high.example/manifest.json');
  const low = record('low', 100, 'https://low.example/manifest.json');
  const fetcher = jest.fn(async (url: string) => {
    const payload = url.startsWith('https://high.example')
      ? {
        subtitles: [{
          id: 'shared',
          url: 'https://cdn.example/shared.vtt',
        }],
      }
      : {
        subtitles: [{
          id: 'shared-fr',
          lang: 'fr',
          name: 'French',
          url: 'https://cdn.example/shared.vtt',
        }],
      };
    const body = JSON.stringify(payload);
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  const tracks = await createSubtitleResolver([low, high], fetcher).resolve(
    request,
    ['fr'],
  );

  expect(tracks).toEqual([
    {
      id: 'high:shared',
      language: 'fr',
      label: 'French',
      url: 'https://cdn.example/shared.vtt',
    },
  ]);
});

test('one failed subtitle provider does not fail the remaining providers', async () => {
  const broken = record('broken', 200, 'https://broken.example/manifest.json');
  const working = record('working', 100, 'https://working.example/manifest.json');
  const fetcher = jest.fn(async (url: string) => {
    if (url.startsWith('https://broken.example')) throw new Error('offline');
    const body = JSON.stringify({
      subtitles: [{ id: 'fr', lang: 'fr', url: 'https://cdn.example/fr.vtt' }],
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  await expect(
    createSubtitleResolver([broken, working], fetcher).resolve(request, ['fr']),
  ).resolves.toEqual([
    expect.objectContaining({
      language: 'fr',
      url: 'https://cdn.example/fr.vtt',
    }),
  ]);
});


test('bounds alternate subtitle routes to one provider timeout budget', async () => {
  const tmdb = record(
    'tmdb',
    100,
    'https://tmdb.example/manifest.json',
  );
  tmdb.descriptor = {
    ...tmdb.descriptor!,
    subtitle: {
      types: ['movie'],
      idPrefixes: ['tmdb:'],
    },
  };
  const now = jest.spyOn(Date, 'now');
  now
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(1_500)
    .mockReturnValueOnce(2_001);
  const fetcher = jest.fn(async () => {
    const body = JSON.stringify({ subtitles: [] });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  try {
    await createSubtitleResolver(
      [tmdb],
      fetcher,
      1_000,
    ).resolve({
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550' },
    }, ['fr']);
  } finally {
    now.mockRestore();
  }

  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(
    'https://tmdb.example/subtitles/movie/tmdb%3A550.json',
    expect.any(Object),
  );
});

test('reserves subtitle provider budget for alternate accepted ids', async () => {
  jest.useFakeTimers();
  try {
    const tmdb = record(
      'tmdb',
      100,
      'https://tmdb.example/manifest.json',
    );
    tmdb.descriptor = {
      ...tmdb.descriptor!,
      subtitle: {
        types: ['movie'],
        idPrefixes: ['tmdb:'],
      },
    };
    const fetcher = jest.fn((url: string) => {
      if (url.includes('tmdb%3A550.json')) {
        return new Promise<any>(() => undefined);
      }
      const body = JSON.stringify({
        subtitles: [{
          id: 'fr',
          lang: 'fr',
          url: 'https://cdn.example/fr.vtt',
        }],
      });
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => String(body.length) },
        text: async () => body,
      });
    });

    const pending = createSubtitleResolver(
      [tmdb],
      fetcher,
      40,
    ).resolve({
      mediaId: 'tmdb:movie:550',
      kind: 'movie',
      externalIds: { tmdb: '550' },
    }, ['fr']);

    await jest.advanceTimersByTimeAsync(21);

    await expect(pending).resolves.toEqual([
      expect.objectContaining({
        language: 'fr',
        url: 'https://cdn.example/fr.vtt',
      }),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

test('resolves catalog-native subtitle routes without external IDs', async () => {
  const native = record(
    'native',
    100,
    'https://native.example/manifest.json',
  );
  native.descriptor = {
    ...native.descriptor!,
    subtitle: {
      types: ['movie', 'series'],
      idPrefixes: ['custom:'],
    },
  };
  const calls: string[] = [];
  const fetcher = jest.fn(async (url: string) => {
    calls.push(url);
    const body = JSON.stringify({
      subtitles: [{
        id: 'fr',
        lang: 'fr',
        url: 'https://cdn.example/native-fr.vtt',
      }],
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  const tracks = await createSubtitleResolver(
    [native],
    fetcher,
  ).resolve({
    mediaId: 'stremio-native:movie:custom%3A42',
    kind: 'movie',
    externalIds: {},
  }, ['fr']);

  expect(calls).toEqual([
    'https://native.example/subtitles/movie/custom%3A42.json',
  ]);
  expect(tracks[0]?.url).toBe('https://cdn.example/native-fr.vtt');
});

test('tries type-qualified TMDB subtitle fallback when the first route is empty', async () => {
  const tmdb = record(
    'tmdb',
    100,
    'https://tmdb.example/manifest.json',
  );
  tmdb.descriptor = {
    ...tmdb.descriptor!,
    subtitle: {
      types: ['movie', 'series'],
      idPrefixes: ['tmdb:'],
    },
  };
  const calls: string[] = [];
  const fetcher = jest.fn(async (url: string) => {
    calls.push(url);
    const body = JSON.stringify({
      subtitles: url.includes('tmdb%3Amovie%3A550')
        ? [{
          id: 'fr',
          lang: 'fr',
          url: 'https://cdn.example/fr.vtt',
        }]
        : [],
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  const tracks = await createSubtitleResolver(
    [tmdb],
    fetcher,
  ).resolve({
    mediaId: 'tmdb:movie:550',
    kind: 'movie',
    externalIds: { tmdb: '550' },
  }, ['fr']);

  expect(calls).toEqual([
    'https://tmdb.example/subtitles/movie/tmdb%3A550.json',
    'https://tmdb.example/subtitles/movie/tmdb%3Amovie%3A550.json',
  ]);
  expect(tracks[0]?.url).toBe('https://cdn.example/fr.vtt');
});

test('rejects insecure non-loopback subtitle provider endpoints without fetching', async () => {
  const insecure = record(
    'insecure',
    100,
    'http://example.com/manifest.json',
  );
  const fetcher = jest.fn(async () => {
    const body = JSON.stringify({ subtitles: [] });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  await expect(
    createSubtitleResolver([insecure], fetcher).resolve(request, ['fr']),
  ).resolves.toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
});

test('preserves secure manifest query configuration on subtitle requests', async () => {
  const configured = record(
    'configured',
    100,
    'https://subs.example/manifest.json?token=LOCAL-ONLY#fragment',
  );
  const fetcher = jest.fn(async () => {
    const body = JSON.stringify({ subtitles: [] });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  await createSubtitleResolver([configured], fetcher).resolve(request, ['fr']);

  expect(fetcher).toHaveBeenCalledWith(
    'https://subs.example/subtitles/movie/tt0137523.json?token=LOCAL-ONLY',
    expect.any(Object),
  );
});


test('allows harmless double dots inside subtitle resource ids', async () => {
  const configured = record(
    'custom',
    100,
    'https://subs.example/manifest.json',
  );
  configured.descriptor = {
    ...configured.descriptor!,
    subtitle: {
      types: ['movie'],
      idPrefixes: ['custom:'],
    },
  };
  const fetcher = jest.fn(async () => {
    const body = JSON.stringify({ subtitles: [] });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  await createSubtitleResolver([configured], fetcher).resolve({
    mediaId: 'stremio-catalog:movie:custom%3Amovie..backup',
    kind: 'movie',
    externalIds: {},
  }, ['fr']);

  expect(fetcher).toHaveBeenCalledWith(
    'https://subs.example/subtitles/movie/custom%3Amovie..backup.json',
    expect.any(Object),
  );
});

test('bounds merged subtitle results across many providers', async () => {
  const providers = [
    record('one', 300, 'https://one.example/manifest.json'),
    record('two', 200, 'https://two.example/manifest.json'),
    record('three', 100, 'https://three.example/manifest.json'),
  ];
  const fetcher = jest.fn(async (url: string) => {
    const provider = new URL(url).hostname.split('.')[0];
    const subtitles = Array.from({ length: 500 }, (_, index) => ({
      id: `${provider}-${index}`,
      lang: 'en',
      url: `https://cdn.example/${provider}-${index}.vtt`,
    }));
    const body = JSON.stringify({ subtitles });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  const tracks = await createSubtitleResolver(
    providers,
    fetcher,
  ).resolve(request, ['en']);

  expect(tracks).toHaveLength(1_000);
  expect(tracks[0]?.id).toContain('one:');
  expect(tracks[999]?.id).toContain('two:');
  expect(tracks.some((track) => track.id.startsWith('three:')))
    .toBe(false);
});


test('caps subtitle provider fanout after priority ordering', async () => {
  const providers = Array.from({ length: 105 }, (_, index) => (
    record(
      `provider-${index}`,
      index,
      `https://provider-${index}.example/manifest.json`,
    )
  ));
  const calls: string[] = [];
  const fetcher = jest.fn(async (url: string) => {
    calls.push(url);
    const body = JSON.stringify({ subtitles: [] });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  await createSubtitleResolver(
    providers,
    fetcher,
  ).resolve(request, ['en']);

  expect(calls).toHaveLength(100);
  expect(
    calls.some((url) => url.includes('provider-104.example')),
  ).toBe(true);
  expect(
    calls.some((url) => url.includes('provider-0.example')),
  ).toBe(false);
});


test('ignores malformed subtitle capability metadata without breaking healthy providers', async () => {
  const malformed = record(
    'malformed',
    200,
    'https://malformed.example/manifest.json',
  ) as any;
  malformed.descriptor = {
    ...malformed.descriptor,
    capabilities: null,
  };
  const healthy = record(
    'healthy',
    100,
    'https://healthy.example/manifest.json',
  );
  const fetcher = jest.fn(async (url: string) => {
    const body = JSON.stringify({
      subtitles: url.includes('healthy.example')
        ? [{ id: 'fr', lang: 'fr', url: 'https://cdn.example/fr.vtt' }]
        : [],
    });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  const tracks = await createSubtitleResolver(
    [malformed, healthy],
    fetcher,
  ).resolve(request, ['fr']);

  expect(tracks).toEqual([
    expect.objectContaining({
      language: 'fr',
      url: 'https://cdn.example/fr.vtt',
    }),
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});


test('bounds concurrent subtitle provider requests', async () => {
  const providers = Array.from({ length: 20 }, (_, index) => (
    record(
      `provider-${index}`,
      1000 - index,
      `https://provider-${index}.example/manifest.json`,
    )
  ));
  let active = 0;
  let maxActive = 0;
  const fetcher = jest.fn(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    const body = JSON.stringify({ subtitles: [] });
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    };
  });

  await createSubtitleResolver(
    providers,
    fetcher,
  ).resolve(request, ['fr', 'en']);

  expect(fetcher).toHaveBeenCalledTimes(20);
  expect(maxActive).toBeLessThanOrEqual(8);
});


test('does not starve a queued healthy subtitle provider behind slow providers', async () => {
  jest.useFakeTimers();
  const slow = Array.from({ length: 8 }, (_, index) => (
    record(
      `slow-${index}`,
      1000 - index,
      `https://slow-${index}.example/manifest.json`,
    )
  ));
  const healthy = record(
    'healthy',
    100,
    'https://healthy.example/manifest.json',
  );
  const fetcher = jest.fn((url: string) => {
    if (!url.includes('healthy.example')) {
      return new Promise<never>(() => {});
    }
    const body = JSON.stringify({
      subtitles: [{
        id: 'fr',
        lang: 'fr',
        url: 'https://cdn.example/healthy-fr.vtt',
      }],
    });
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => String(body.length) },
      text: async () => body,
    });
  });

  try {
    const pending = createSubtitleResolver(
      [...slow, healthy],
      fetcher,
      80,
    ).resolve(request, ['fr']);

    await jest.advanceTimersByTimeAsync(40);

    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes('healthy.example')),
    ).toBe(true);

    await jest.advanceTimersByTimeAsync(40);
    await expect(pending).resolves.toEqual([
      expect.objectContaining({
        language: 'fr',
        url: 'https://cdn.example/healthy-fr.vtt',
      }),
    ]);
  } finally {
    jest.useRealTimers();
  }
});
