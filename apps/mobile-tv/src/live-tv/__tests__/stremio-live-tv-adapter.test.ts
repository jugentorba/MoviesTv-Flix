import type { LiveTvProviderDescriptor } from '@moviestv/live-tv';
import { StremioLiveTvAdapter } from '../StremioLiveTvAdapter';

function response(payload: unknown) {
  const body = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(Buffer.byteLength(body)) },
    text: async () => body,
  };
}

const provider: LiveTvProviderDescriptor = {
  addonId: 'provider',
  name: 'Provider',
  manifestUrl: 'https://provider.example/manifest.json?token=LOCAL-ONLY#ignored',
  priority: 100,
  liveTv: {
    catalogs: [{ type: 'channel', id: 'all', name: 'All Channels' }],
    streamTypes: ['channel'],
  },
};

describe('StremioLiveTvAdapter', () => {
  it('loads catalog channels through encoded provider routes', async () => {
    const calls: string[] = [];
    const adapter = new StremioLiveTvAdapter(async (url) => {
      calls.push(url);
      return response({ metas: [{ type: 'channel', id: 'rtk 1', name: 'RTK 1', countryCode: 'xk' }] });
    });

    const channels = await adapter.listChannels(provider);

    expect(calls).toEqual(['https://provider.example/catalog/channel/all.json?token=LOCAL-ONLY']);
    expect(channels).toEqual([
      expect.objectContaining({ id: 'provider:channel:rtk 1', title: 'RTK 1', countryCode: 'XK' }),
    ]);
  });

  it('aborts catalog discovery at a shorter service-provided budget', async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetcher = jest.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<any>(() => undefined);
      });
      const adapter = new StremioLiveTvAdapter(fetcher as never, 8_000);

      const pending = adapter.listChannels(
        provider,
        { timeoutMs: 25 },
      );
      const rejection = expect(pending).rejects.toThrow(
        'Provider request timed out',
      );
      await jest.advanceTimersByTimeAsync(26);

      await rejection;
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('resolves channel streams with the existing stream normalizer', async () => {
    const calls: string[] = [];
    const adapter = new StremioLiveTvAdapter(async (url) => {
      calls.push(url);
      return response({ streams: [{ id: 'main', url: 'https://stream.example/live.m3u8', name: '1080p English' }] });
    });
    const channel = {
      id: 'provider:channel:rtk 1', providerId: 'provider', remoteId: 'rtk 1',
      resourceType: 'channel' as const, title: 'RTK 1',
    };

    const sources = await adapter.resolveChannel(provider, channel);

    expect(calls).toEqual(['https://provider.example/stream/channel/rtk%201.json?token=LOCAL-ONLY']);
    expect(sources).toEqual([
      expect.objectContaining({ providerId: 'provider', url: 'https://stream.example/live.m3u8', quality: '1080p', language: 'en' }),
    ]);
  });

  it('aborts stream resolution at a shorter controller budget', async () => {
    jest.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetcher = jest.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<any>(() => undefined);
      });
      const adapter = new StremioLiveTvAdapter(fetcher as never, 8_000);
      const selected = {
        id: 'provider:channel:rtk1',
        providerId: 'provider',
        remoteId: 'rtk1',
        resourceType: 'channel' as const,
        title: 'RTK 1',
      };

      const pending = adapter.resolveChannel(
        provider,
        selected,
        { timeoutMs: 25 },
      );
      const rejection = expect(pending).rejects.toThrow(
        'Provider request timed out',
      );
      await jest.advanceTimersByTimeAsync(26);

      await rejection;
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps loopback HTTP Live TV providers available for development', async () => {
    const localProvider: LiveTvProviderDescriptor = {
      ...provider,
      manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    };
    const calls: string[] = [];
    const adapter = new StremioLiveTvAdapter(async (url) => {
      calls.push(url);
      return response({ metas: [] });
    });

    await adapter.listChannels(localProvider);

    expect(calls).toEqual([
      'http://127.0.0.1:7000/catalog/channel/all.json',
    ]);
  });

  it('allows harmless double dots inside Live TV channel ids', async () => {
    const calls: string[] = [];
    const adapter = new StremioLiveTvAdapter(async (url) => {
      calls.push(url);
      return response({ streams: [] });
    });
    const channel = {
      id: 'provider:channel:news..backup',
      providerId: 'provider',
      remoteId: 'news..backup',
      resourceType: 'channel' as const,
      title: 'News Backup',
    };

    await adapter.resolveChannel(provider, channel);

    expect(calls).toEqual([
      'https://provider.example/stream/channel/news..backup.json?token=LOCAL-ONLY',
    ]);
  });

  it('rejects insecure non-loopback Live TV providers before fetching', async () => {
    const insecureProvider: LiveTvProviderDescriptor = {
      ...provider,
      manifestUrl: 'http://example.com/manifest.json',
    };
    const fetcher = jest.fn(async () => response({ metas: [] }));
    const adapter = new StremioLiveTvAdapter(fetcher);

    await expect(adapter.listChannels(insecureProvider))
      .rejects.toThrow('secure HTTPS');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects a channel owned by another provider', async () => {
    const adapter = new StremioLiveTvAdapter(async () => response({ streams: [] }));
    const channel = {
      id: 'other:channel:x', providerId: 'other', remoteId: 'x',
      resourceType: 'channel' as const, title: 'Other',
    };

    await expect(adapter.resolveChannel(provider, channel)).rejects.toThrow('does not belong');
  });
});


  it('preserves provider request headers on protected Live TV streams', async () => {
    const adapter = new StremioLiveTvAdapter(async () => response({
      streams: [{
        id: 'protected',
        url: 'https://stream.example/protected.m3u8',
        behaviorHints: {
          proxyHeaders: {
            request: {
              Referer: 'https://provider.example/',
              Authorization: 'Bearer runtime-only',
            },
          },
        },
      }],
    }));
    const channel = {
      id: 'provider:channel:protected',
      providerId: 'provider',
      remoteId: 'protected',
      resourceType: 'channel' as const,
      title: 'Protected',
    };

    const [source] = await adapter.resolveChannel(provider, channel);

    expect(source?.headers).toEqual({
      Referer: 'https://provider.example/',
      Authorization: 'Bearer runtime-only',
    });
  });


  it('deduplicates identical Live TV URLs but preserves header-dependent variants', async () => {
    const adapter = new StremioLiveTvAdapter(async () => response({
      streams: [
        {
          id: 'plain-1',
          url: 'https://stream.example/live.m3u8',
        },
        {
          id: 'plain-2',
          url: 'https://stream.example/live.m3u8#duplicate',
        },
        {
          id: 'protected',
          url: 'https://stream.example/live.m3u8',
          behaviorHints: {
            proxyHeaders: {
              request: {
                Referer: 'https://provider.example/',
              },
            },
          },
        },
      ],
    }));
    const channel = {
      id: 'provider:channel:top',
      providerId: 'provider',
      remoteId: 'top',
      resourceType: 'channel' as const,
      title: 'Top',
    };

    const sources = await adapter.resolveChannel(provider, channel);

    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual(expect.objectContaining({
      id: 'provider:plain-1',
      url: 'https://stream.example/live.m3u8',
    }));
    expect(sources[1]).toEqual(expect.objectContaining({
      id: 'provider:protected',
      headers: {
        Referer: 'https://provider.example/',
      },
    }));
  });


  it('keeps channels from healthy catalogs when another catalog fails', async () => {
    const multiProvider: LiveTvProviderDescriptor = {
      ...provider,
      liveTv: {
        ...provider.liveTv,
        catalogs: [
          { type: 'channel', id: 'al', name: 'Albania' },
          { type: 'channel', id: 'fr', name: 'France' },
        ],
      },
    };

    const adapter = new StremioLiveTvAdapter(async (url) => {
      if (url.includes('/catalog/channel/al.json')) {
        throw new Error('catalog offline');
      }
      return response({
        metas: [{
          type: 'channel',
          id: 'france2',
          name: 'France 2',
          countryCode: 'FR',
        }],
      });
    });

    await expect(adapter.listChannels(multiProvider)).resolves.toEqual([
      expect.objectContaining({
        id: 'provider:channel:france2',
        title: 'France 2',
        countryCode: 'FR',
      }),
    ]);
  });

  it('fails provider loading when every configured catalog fails', async () => {
    const multiProvider: LiveTvProviderDescriptor = {
      ...provider,
      liveTv: {
        ...provider.liveTv,
        catalogs: [
          { type: 'channel', id: 'al', name: 'Albania' },
          { type: 'channel', id: 'fr', name: 'France' },
        ],
      },
    };

    const adapter = new StremioLiveTvAdapter(async () => {
      throw new Error('provider offline');
    });

    await expect(adapter.listChannels(multiProvider))
      .rejects.toThrow('provider offline');
  });


test('stops starting new Live TV catalog requests after the provider budget expires', async () => {
  const manyCatalogs: LiveTvProviderDescriptor = {
    ...provider,
    liveTv: {
      ...provider.liveTv,
      catalogs: Array.from({ length: 24 }, (_, index) => ({
        type: 'channel' as const,
        id: `catalog-${index}`,
        name: `Catalog ${index}`,
      })),
    },
  };
  const originalNow = Date.now;
  let nowCalls = 0;
  const now = jest.spyOn(Date, 'now').mockImplementation(() => {
    nowCalls += 1;
    return nowCalls <= 9 ? 1_000 : 9_001;
  });
  const fetcher = jest.fn(async () => response({ metas: [] }));
  const adapter = new StremioLiveTvAdapter(fetcher as never, 8_000);

  try {
    await adapter.listChannels(manyCatalogs);
  } finally {
    now.mockRestore();
    Date.now = originalNow;
  }

  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(8);
});

test('limits concurrent Live TV catalog requests per provider', async () => {
  const manyCatalogs: LiveTvProviderDescriptor = {
    ...provider,
    liveTv: {
      ...provider.liveTv,
      catalogs: Array.from({ length: 24 }, (_, index) => ({
        type: 'channel' as const,
        id: `catalog-${index}`,
        name: `Catalog ${index}`,
      })),
    },
  };
  let active = 0;
  let maxActive = 0;
  const gates: Array<() => void> = [];
  const adapter = new StremioLiveTvAdapter(async (url) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => {
      gates.push(resolve);
      if (gates.length % 8 === 0) {
        const batch = gates.splice(0, gates.length);
        batch.forEach((release) => release());
      }
    });
    active -= 1;
    const match = /catalog-(\d+)/.exec(url);
    return response({
      metas: [{
        type: 'channel',
        id: `channel-${match?.[1] ?? '0'}`,
        name: `Channel ${match?.[1] ?? '0'}`,
      }],
    });
  });

  const loading = adapter.listChannels(manyCatalogs);
  await Promise.resolve();
  expect(maxActive).toBeLessThanOrEqual(8);

  while (gates.length) {
    const batch = gates.splice(0, gates.length);
    batch.forEach((release) => release());
    await Promise.resolve();
  }

  const channels = await loading;
  expect(channels).toHaveLength(24);
  expect(maxActive).toBeLessThanOrEqual(8);
});

test('bounds Live TV catalog fanout per provider', async () => {
  const manyCatalogs: LiveTvProviderDescriptor = {
    ...provider,
    liveTv: {
      ...provider.liveTv,
      catalogs: Array.from({ length: 150 }, (_, index) => ({
        type: 'channel' as const,
        id: `catalog-${index}`,
        name: `Catalog ${index}`,
      })),
    },
  };
  const calls: string[] = [];
  const adapter = new StremioLiveTvAdapter(async (url) => {
    calls.push(url);
    const match = /catalog-(\d+)/.exec(url);
    const index = match?.[1] ?? '0';
    return response({
      metas: [{
        type: 'channel',
        id: `channel-${index}`,
        name: `Channel ${index}`,
      }],
    });
  });

  const channels = await adapter.listChannels(manyCatalogs);

  expect(calls).toHaveLength(100);
  expect(channels).toHaveLength(100);
});


test('provider channel sorting does not depend on localeCompare', async () => {
  const localeCompare = jest.spyOn(
    String.prototype,
    'localeCompare',
  ).mockImplementation(() => 99);

  try {
    const adapter = new StremioLiveTvAdapter(async () => response({
      metas: [
        { type: 'channel', id: 'eclair', name: 'Éclair TV' },
        { type: 'channel', id: 'alpha', name: 'Alpha TV' },
      ],
    }));

    const channels = await adapter.listChannels(provider);

    expect(channels.map((channel) => channel.title)).toEqual([
      'Alpha TV',
      'Éclair TV',
    ]);
    expect(localeCompare).not.toHaveBeenCalled();
  } finally {
    localeCompare.mockRestore();
  }
});


test('deduplicates only after required-extra catalogs are removed', async () => {
  const calls: string[] = [];
  const adapter = new StremioLiveTvAdapter(async (url) => {
    calls.push(url);
    return response({ metas: [] });
  });
  const duplicateProvider: LiveTvProviderDescriptor = {
    ...provider,
    liveTv: {
      ...provider.liveTv,
      catalogs: [
        {
          type: 'channel',
          id: 'all',
          name: 'Search-only All',
          requiredExtras: ['search'],
        },
        {
          type: 'channel',
          id: 'all',
          name: 'All Channels',
        },
      ],
    },
  };

  await adapter.listChannels(duplicateProvider);

  expect(calls).toEqual([
    'https://provider.example/catalog/channel/all.json?token=LOCAL-ONLY',
  ]);
});


test('does not starve a queued healthy Live TV catalog behind slow catalogs', async () => {
  jest.useFakeTimers();
  const manyCatalogs: LiveTvProviderDescriptor = {
    ...provider,
    liveTv: {
      ...provider.liveTv,
      catalogs: [
        ...Array.from({ length: 8 }, (_, index) => ({
          type: 'channel' as const,
          id: `slow-${index}`,
          name: `Slow ${index}`,
        })),
        {
          type: 'channel' as const,
          id: 'healthy',
          name: 'Healthy',
        },
      ],
    },
  };
  const fetcher = jest.fn((url: string) => {
    if (!url.includes('/catalog/channel/healthy.json')) {
      return new Promise<never>(() => {});
    }
    return Promise.resolve(response({
      metas: [{
        type: 'channel',
        id: 'healthy-channel',
        name: 'Healthy Channel',
      }],
    }));
  });
  const adapter = new StremioLiveTvAdapter(fetcher, 80);

  try {
    const pending = adapter.listChannels(manyCatalogs);
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(40);

    expect(
      fetcher.mock.calls.some(([url]) => String(url).includes('/healthy.json')),
    ).toBe(true);

    await jest.advanceTimersByTimeAsync(40);
    await expect(pending).resolves.toEqual([
      expect.objectContaining({
        id: 'provider:channel:healthy-channel',
        title: 'Healthy Channel',
      }),
    ]);
  } finally {
    jest.useRealTimers();
  }
});
