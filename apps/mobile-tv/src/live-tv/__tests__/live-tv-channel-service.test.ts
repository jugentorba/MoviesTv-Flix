import type { LiveTvProviderDescriptor } from '@moviestv/live-tv';
import { LiveTvChannelService } from '../LiveTvChannelService';

const providers: LiveTvProviderDescriptor[] = [
  { addonId: 'good', name: 'Good', manifestUrl: 'https://good.example/manifest.json', priority: 100, liveTv: { catalogs: [], streamTypes: ['channel'] } },
  { addonId: 'bad', name: 'Bad', manifestUrl: 'https://bad.example/manifest.json', priority: 50, liveTv: { catalogs: [], streamTypes: ['channel'] } },
];

describe('LiveTvChannelService', () => {
  it('isolates provider failures, caches safe metadata, and refreshes explicitly', async () => {
    const calls: string[] = [];
    const adapter = { listChannels: async (provider: LiveTvProviderDescriptor) => {
      calls.push(provider.addonId);
      if (provider.addonId === 'bad') throw new Error('private provider detail');
      return [{
        id: 'good:channel:1', providerId: 'good', remoteId: '1', resourceType: 'channel' as const,
        title: 'France 2', countryCode: 'FR', url: 'https://must-not-cache.example', headers: { Authorization: 'secret' },
      } as any];
    } };
    const service = new LiveTvChannelService(adapter, () => 1_000);

    const first = await service.load(providers);
    expect(first.failedProviderIds).toEqual(['bad']);
    expect(first.channels).toHaveLength(1);
    expect(first.channels[0]).not.toHaveProperty('url');
    expect(first.channels[0]).not.toHaveProperty('headers');

    await service.load(providers);
    expect(calls).toEqual(['good', 'bad', 'bad']);

    await service.load(providers, { refresh: true });
    expect(calls).toEqual(['good', 'bad', 'bad', 'good', 'bad']);
  });

  it('merges duplicate stations from healthy providers and keeps variants', async () => {
    const service = new LiveTvChannelService({
      listChannels: async (selected) => (
        selected.addonId === 'good'
          ? [{
            id: 'good:channel:fr2',
            providerId: 'good',
            remoteId: 'fr2',
            resourceType: 'channel' as const,
            title: 'France 2',
            countryCode: 'FR',
          }]
          : [{
            id: 'bad:channel:france2',
            providerId: 'bad',
            remoteId: 'france2',
            resourceType: 'channel' as const,
            title: 'Fránce-2',
            countryCode: 'FR',
          }]
      ),
    }, () => 1_000);

    const result = await service.load(providers);

    expect(result.failedProviderIds).toEqual([]);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]?.variants.map(
      (variant) => variant.provider.addonId,
    )).toEqual(['good', 'bad']);
  });



  it('reports truncated providers that were part of this load', async () => {
    const service = new LiveTvChannelService({
      listChannels: async (selected) => [{
        id: `${selected.addonId}:channel:1`,
        providerId: selected.addonId,
        remoteId: '1',
        resourceType: 'channel' as const,
        title: `Channel ${selected.addonId}`,
      }],
      truncatedProviderIds: () => ['bad', 'not-loaded-any-more'],
    }, () => 1_000);

    const result = await service.load(providers);

    expect(result.truncatedProviderIds).toEqual(['bad']);
  });

  it('reports no truncation when the adapter does not implement it', async () => {
    const service = new LiveTvChannelService({
      listChannels: async () => [],
    }, () => 1_000);

    expect((await service.load(providers)).truncatedProviderIds).toEqual([]);
  });

  it('reuses cached channels when only provider priority changes', async () => {
    const calls: number[] = [];
    const service = new LiveTvChannelService({
      listChannels: async (selected) => {
        calls.push(selected.priority);
        return [{
          id: 'good:channel:fr2',
          providerId: 'good',
          remoteId: 'fr2',
          resourceType: 'channel' as const,
          title: 'France 2',
          countryCode: 'FR',
        }];
      },
    }, () => 1_000);

    await service.load([{ ...providers[0]!, priority: 100 }]);
    const reordered = await service.load([
      { ...providers[0]!, priority: 5 },
    ]);

    expect(calls).toEqual([100]);
    expect(reordered.channels).toHaveLength(1);
    expect(reordered.channels[0]?.variants[0]?.provider.priority).toBe(5);
  });

  it('does not reuse cached channels when the same addon id points to a different provider endpoint', async () => {
    const calls: string[] = [];
    const service = new LiveTvChannelService({
      listChannels: async (selected) => {
        calls.push(selected.manifestUrl);
        const suffix = selected.manifestUrl.includes('account-b')
          ? 'B'
          : 'A';
        return [{
          id: `good:channel:${suffix.toLowerCase()}`,
          providerId: 'good',
          remoteId: suffix.toLowerCase(),
          resourceType: 'channel' as const,
          title: `Account ${suffix} Channel`,
          countryCode: 'FR',
        }];
      },
    }, () => 1_000);

    const accountA: LiveTvProviderDescriptor = {
      ...providers[0]!,
      manifestUrl: 'https://account-a.example/manifest.json',
    };
    const accountB: LiveTvProviderDescriptor = {
      ...providers[0]!,
      manifestUrl: 'https://account-b.example/manifest.json',
    };

    const first = await service.load([accountA]);
    const second = await service.load([accountB]);

    expect(first.channels.map((item) => item.title)).toEqual([
      'Account A Channel',
    ]);
    expect(second.channels.map((item) => item.title)).toEqual([
      'Account B Channel',
    ]);
    expect(calls).toEqual([
      'https://account-a.example/manifest.json',
      'https://account-b.example/manifest.json',
    ]);
  });

  it('keeps stale channel metadata when an explicit refresh temporarily fails', async () => {
    let now = 1_000;
    let fail = false;
    const service = new LiveTvChannelService({
      listChannels: async (selected) => {
        if (selected.addonId === 'bad') return [];
        if (fail) throw new Error('temporary outage');
        return [{
          id: 'good:channel:fr2',
          providerId: 'good',
          remoteId: 'fr2',
          resourceType: 'channel' as const,
          title: 'France 2',
          countryCode: 'FR',
        }];
      },
    }, () => now);

    const first = await service.load([providers[0]!]);
    expect(first.channels.map((item) => item.title)).toEqual(['France 2']);

    fail = true;
    now += 20 * 60 * 1000;
    const refreshed = await service.load([providers[0]!], { refresh: true });

    expect(refreshed.failedProviderIds).toEqual(['good']);
    expect(refreshed.channels.map((item) => item.title)).toEqual(['France 2']);
  });

  it('keeps the newest channel list cached when an older refresh finishes last', async () => {
    let resolveFirst!: (channels: any[]) => void;
    let resolveSecond!: (channels: any[]) => void;
    const first = new Promise<any[]>((resolve) => { resolveFirst = resolve; });
    const second = new Promise<any[]>((resolve) => { resolveSecond = resolve; });
    let calls = 0;
    const service = new LiveTvChannelService({
      listChannels: async () => {
        calls += 1;
        return calls === 1 ? first : second;
      },
    }, () => 1_000);
    const selected = [providers[0]!];

    const olderLoad = service.load(selected, { refresh: true });
    const newerLoad = service.load(selected, { refresh: true });

    resolveSecond([{
      id: 'good:channel:new',
      providerId: 'good',
      remoteId: 'new',
      resourceType: 'channel',
      title: 'New list',
    }]);
    await newerLoad;

    resolveFirst([{
      id: 'good:channel:old',
      providerId: 'good',
      remoteId: 'old',
      resourceType: 'channel',
      title: 'Old list',
    }]);
    await olderLoad;

    const cached = await service.load(selected);
    expect(calls).toBe(2);
    expect(cached.channels.map((item) => item.title)).toEqual(['New list']);
  });

});


  it('drops malformed and cross-provider channel metadata while normalizing valid records', async () => {
    const service = new LiveTvChannelService({
      listChannels: async () => [
        { id: 'good:channel:1', providerId: 'other', remoteId: '1', resourceType: 'channel', title: 'Wrong provider' },
        { id: '', providerId: 'good', remoteId: '2', resourceType: 'channel', title: 'Missing id' },
        { id: 'good:channel:3', providerId: 'good', remoteId: '3', resourceType: 'channel', title: '  France 3  ', countryCode: ' fr ' },
      ] as any,
    }, () => 1_000);

    const result = await service.load([providers[0]!]);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toMatchObject({ title: 'France 3', countryCode: 'FR' });
  });


test('bounds provider fanout before loading Live TV channels', async () => {
  const manyProviders: LiveTvProviderDescriptor[] = Array.from(
    { length: 105 },
    (_, index) => ({
      addonId: `provider-${index}`,
      name: `Provider ${index}`,
      manifestUrl: `https://provider-${index}.example/manifest.json`,
      priority: index,
      liveTv: { catalogs: [], streamTypes: ['channel'] },
    }),
  );
  const calls: string[] = [];
  const service = new LiveTvChannelService({
    listChannels: async (selected) => {
      calls.push(selected.addonId);
      return [{
        id: `${selected.addonId}:channel:main`,
        providerId: selected.addonId,
        remoteId: 'main',
        resourceType: 'channel',
        title: selected.name,
      }];
    },
  }, () => 1_000);

  const result = await service.load(manyProviders);

  expect(result.providerCount).toBe(100);
  expect(calls).toHaveLength(100);
  expect(calls).toContain('provider-104');
  expect(calls).not.toContain('provider-0');
});

test('sanitizes channel metadata before caching and aggregation', async () => {
  const service = new LiveTvChannelService({
    listChannels: async () => [
      {
        id: 'good:channel:valid',
        providerId: 'good',
        remoteId: 'valid',
        resourceType: 'channel',
        title: '  France 2  ',
        countryCode: ' fr ',
        posterUrl: 'https://user:pass@img.example/fr2.png',
        genres: [' News ', 'News', 'x'.repeat(129)],
      },
      {
        id: 'good:channel:bad-title',
        providerId: 'good',
        remoteId: 'bad-title',
        resourceType: 'channel',
        title: 123,
      },
    ] as any,
  }, () => 1_000);

  const result = await service.load([providers[0]!]);

  expect(result.channels).toHaveLength(1);
  expect(result.channels[0]).toEqual(expect.objectContaining({
    title: 'France 2',
    countryCode: 'FR',
    genres: ['News'],
  }));
  expect(result.channels[0]?.posterUrl).toBeUndefined();
});


test('bounds Live TV cache and clears completed load generations', async () => {
  const service = new LiveTvChannelService({
    listChannels: async (selected) => [{
      id: `${selected.addonId}:channel:main`,
      providerId: selected.addonId,
      remoteId: 'main',
      resourceType: 'channel',
      title: selected.name,
    }],
  }, () => 1_000);

  for (let index = 0; index < 205; index += 1) {
    await service.load([{
      addonId: 'provider',
      name: `Provider ${index}`,
      manifestUrl: `https://provider.example/${index}/manifest.json`,
      priority: 100,
      liveTv: { catalogs: [], streamTypes: ['channel'] },
    }], { refresh: true });
  }

  expect((service as any).cache.size).toBeLessThanOrEqual(200);
  expect((service as any).loadGenerations.size).toBe(0);
});

test('prunes stale Live TV cache entries before loading', async () => {
  let now = 1_000;
  const service = new LiveTvChannelService({
    listChannels: async (selected) => [{
      id: `${selected.addonId}:channel:main`,
      providerId: selected.addonId,
      remoteId: 'main',
      resourceType: 'channel',
      title: selected.name,
    }],
  }, () => now);

  await service.load([providers[0]!]);
  expect((service as any).cache.size).toBe(1);

  now += 24 * 60 * 60 * 1000 + 1;
  await service.load([providers[1]!]);

  expect((service as any).cache.size).toBe(1);
  expect(
    [...(service as any).cache.keys()].some(
      (key: string) => key.includes('"bad"'),
    ),
  ).toBe(true);
});


test('drops signed Live TV artwork URLs before caching', async () => {
  const service = new LiveTvChannelService({
    listChannels: async () => [{
      id: 'good:channel:signed',
      providerId: 'good',
      remoteId: 'signed',
      resourceType: 'channel',
      title: 'Signed artwork',
      posterUrl: 'https://img.example/channel.png#token=LOCAL-SECRET',
    }] as any,
  }, () => 1_000);

  const result = await service.load([providers[0]!]);

  expect(result.channels).toHaveLength(1);
  expect(result.channels[0]?.posterUrl).toBeUndefined();
});

test('drops credentialized Live TV artwork paths before caching', async () => {
  const service = new LiveTvChannelService({
    listChannels: async () => [{
      id: 'good:channel:path-secret',
      providerId: 'good',
      remoteId: 'path-secret',
      resourceType: 'channel',
      title: 'Path secret artwork',
      posterUrl: 'https://img.example/token=fixture-value/channel.png',
    }] as any,
  }, () => 1_000);

  const result = await service.load([providers[0]!]);

  expect(result.channels).toHaveLength(1);
  expect(result.channels[0]?.posterUrl).toBeUndefined();
});

test('drops normalization-expanded Live TV artwork URLs', async () => {
  const service = new LiveTvChannelService({
    listChannels: async () => [{
      id: 'good:channel:expanded',
      providerId: 'good',
      remoteId: 'expanded',
      resourceType: 'channel',
      title: 'Expanded artwork',
      posterUrl: `https://img.example/${'é'.repeat(700)}.png`,
    }] as any,
  }, () => 1_000);

  const result = await service.load([providers[0]!]);

  expect(result.channels).toHaveLength(1);
  expect(result.channels[0]?.posterUrl).toBeUndefined();
});


test('invalidates cached channels when catalog country context changes', async () => {
  const calls: string[] = [];
  const service = new LiveTvChannelService({
    listChannels: async (selected) => {
      const name = selected.liveTv.catalogs[0]?.name ?? 'Unknown';
      calls.push(name);
      return [{
        id: 'good:channel:news',
        providerId: 'good',
        remoteId: 'news',
        resourceType: 'channel',
        title: 'News',
        countryCode: name === 'France' ? 'FR' : 'AL',
      }];
    },
  }, () => 1_000);

  const france: LiveTvProviderDescriptor = {
    ...providers[0]!,
    liveTv: {
      catalogs: [{
        type: 'channel',
        id: 'regional',
        name: 'France',
      }],
      streamTypes: ['channel'],
    },
  };
  const albania: LiveTvProviderDescriptor = {
    ...france,
    liveTv: {
      ...france.liveTv,
      catalogs: [{
        ...france.liveTv.catalogs[0]!,
        name: 'Albania',
      }],
    },
  };

  const first = await service.load([france]);
  const second = await service.load([albania]);

  expect(calls).toEqual(['France', 'Albania']);
  expect(first.channels[0]?.countryCode).toBe('FR');
  expect(second.channels[0]?.countryCode).toBe('AL');
});

test('invalidates cached channels when catalog required extras change', async () => {
  const calls: string[] = [];
  const service = new LiveTvChannelService({
    listChannels: async (selected) => {
      const required = selected.liveTv.catalogs[0]?.requiredExtras ?? [];
      calls.push(required.join(',') || 'none');
      return [{
        id: 'good:channel:fr2',
        providerId: 'good',
        remoteId: 'fr2',
        resourceType: 'channel',
        title: required.length ? 'Required-extra catalog' : 'Browse catalog',
      }];
    },
  }, () => 1_000);

  const browseable: LiveTvProviderDescriptor = {
    ...providers[0]!,
    liveTv: {
      catalogs: [{
        type: 'channel',
        id: 'fr',
        name: 'France',
      }],
      streamTypes: ['channel'],
    },
  };
  const changed: LiveTvProviderDescriptor = {
    ...browseable,
    liveTv: {
      ...browseable.liveTv,
      catalogs: [{
        ...browseable.liveTv.catalogs[0]!,
        requiredExtras: ['search'],
      }],
    },
  };

  const first = await service.load([browseable]);
  const second = await service.load([changed]);

  expect(calls).toEqual(['none', 'search']);
  expect(first.channels[0]?.title).toBe('Browse catalog');
  expect(second.channels[0]?.title).toBe('Required-extra catalog');
});


test('passes shortened discovery budgets into Live TV adapters', async () => {
  const selected: LiveTvProviderDescriptor[] = Array.from(
    { length: 9 },
    (_, index) => ({
      addonId: `budget-${index}`,
      name: `Budget ${index}`,
      manifestUrl: `https://budget-${index}.example/manifest.json`,
      priority: 100 - index,
      liveTv: { catalogs: [], streamTypes: ['channel' as const] },
    }),
  );
  const budgets: number[] = [];
  const service = new LiveTvChannelService({
    listChannels: async (provider, options) => {
      budgets.push(options?.timeoutMs ?? 0);
      return [{
        id: `${provider.addonId}:channel:main`,
        providerId: provider.addonId,
        remoteId: 'main',
        resourceType: 'channel',
        title: provider.name,
      }];
    },
  }, () => 1_000, 80);

  const result = await service.load(selected);

  expect(result.providerCount).toBe(9);
  expect(budgets).toHaveLength(9);
  expect(budgets.every((budget) => budget > 0 && budget <= 40))
    .toBe(true);
});


test('does not let warm cached providers shrink the discovery budget for a cold provider', async () => {
  const warmProviders: LiveTvProviderDescriptor[] = Array.from(
    { length: 8 },
    (_, index) => ({
      addonId: `warm-${index}`,
      name: `Warm ${index}`,
      manifestUrl: `https://warm-${index}.example/manifest.json`,
      priority: 100 - index,
      liveTv: { catalogs: [], streamTypes: ['channel' as const] },
    }),
  );
  const coldProvider: LiveTvProviderDescriptor = {
    addonId: 'cold',
    name: 'Cold',
    manifestUrl: 'https://cold.example/manifest.json',
    priority: 1,
    liveTv: { catalogs: [], streamTypes: ['channel'] },
  };
  const budgets: Array<{ providerId: string; timeoutMs: number }> = [];
  const service = new LiveTvChannelService({
    listChannels: async (provider, options) => {
      budgets.push({
        providerId: provider.addonId,
        timeoutMs: options?.timeoutMs ?? 0,
      });
      return [{
        id: `${provider.addonId}:channel:main`,
        providerId: provider.addonId,
        remoteId: 'main',
        resourceType: 'channel',
        title: provider.name,
      }];
    },
  }, () => 1_000, 80);

  await service.load(warmProviders);
  budgets.length = 0;

  const result = await service.load([...warmProviders, coldProvider]);

  expect(result.providerCount).toBe(9);
  expect(budgets).toEqual([{
    providerId: 'cold',
    timeoutMs: 80,
  }]);
});

test('bounds concurrent Live TV provider channel discovery', async () => {
  const manyProviders: LiveTvProviderDescriptor[] = Array.from(
    { length: 20 },
    (_, index) => ({
      addonId: `provider-${index}`,
      name: `Provider ${index}`,
      manifestUrl: `https://provider-${index}.example/manifest.json`,
      priority: 100 - index,
      liveTv: { catalogs: [], streamTypes: ['channel'] },
    }),
  );
  let active = 0;
  let maxActive = 0;
  const service = new LiveTvChannelService({
    listChannels: async (selected) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return [{
        id: `${selected.addonId}:channel:main`,
        providerId: selected.addonId,
        remoteId: 'main',
        resourceType: 'channel',
        title: selected.name,
      }];
    },
  }, () => 1_000);

  const result = await service.load(manyProviders);

  expect(result.providerCount).toBe(20);
  expect(maxActive).toBeLessThanOrEqual(8);
});


test('does not let hung Live TV providers block queued healthy providers', async () => {
  jest.useFakeTimers();
  const selected: LiveTvProviderDescriptor[] = [
    ...Array.from({ length: 8 }, (_, index) => ({
      addonId: `slow-${index}`,
      name: `Slow ${index}`,
      manifestUrl: `https://slow-${index}.example/manifest.json`,
      priority: 1000 - index,
      liveTv: { catalogs: [], streamTypes: ['channel' as const] },
    })),
    {
      addonId: 'healthy',
      name: 'Healthy',
      manifestUrl: 'https://healthy.example/manifest.json',
      priority: 1,
      liveTv: { catalogs: [], streamTypes: ['channel' as const] },
    },
  ];
  const healthyCalls = jest.fn();
  const service = new LiveTvChannelService({
    listChannels: async (provider) => {
      if (provider.addonId !== 'healthy') {
        return new Promise<never>(() => {});
      }
      healthyCalls();
      return [{
        id: 'healthy:channel:main',
        providerId: 'healthy',
        remoteId: 'main',
        resourceType: 'channel',
        title: 'Healthy Channel',
      }];
    },
  }, () => 1_000, 80);

  try {
    const pending = service.load(selected);
    await Promise.resolve();

    await jest.advanceTimersByTimeAsync(40);
    await Promise.resolve();
    await Promise.resolve();

    expect(healthyCalls).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(40);
    const result = await pending;
    expect(result.channels).toEqual([
      expect.objectContaining({
        title: 'Healthy Channel',
      }),
    ]);
    expect(result.failedProviderIds).toEqual(
      expect.arrayContaining(
        Array.from({ length: 8 }, (_, index) => `slow-${index}`),
      ),
    );
  } finally {
    jest.useRealTimers();
  }
});

describe('LiveTvChannelService playlist channels', () => {
  const playlistProvider: LiveTvProviderDescriptor = {
    addonId: 'm3u:one',
    name: 'Playlist',
    manifestUrl: '',
    priority: 10,
    liveTv: { catalogs: [], streamTypes: ['channel'] },
    kind: 'playlist',
  };

  const playlistChannel = {
    id: 'm3u:news.fr',
    providerId: 'm3u:one',
    remoteId: 'm3u:news.fr',
    resourceType: 'channel' as const,
    title: 'France Info',
    directStreamUrl: 'http://host.example:8080/live/user/pass/12.ts',
  };

  it('keeps a playlist channel stream URL, including through the cache', async () => {
    const calls: string[] = [];
    const service = new LiveTvChannelService({
      listChannels: async () => {
        calls.push('load');
        return [playlistChannel];
      },
    }, () => 1_000);

    const first = await service.load([playlistProvider]);
    const cached = await service.load([playlistProvider]);

    expect(calls).toEqual(['load']);
    expect(first.channels[0]?.variants[0]?.channel.directStreamUrl)
      .toBe(playlistChannel.directStreamUrl);
    expect(cached.channels[0]?.variants[0]?.channel.directStreamUrl)
      .toBe(playlistChannel.directStreamUrl);
  });

  it('strips a stream URL from an add-on provider channel', async () => {
    const service = new LiveTvChannelService({
      listChannels: async (provider) => [{
        ...playlistChannel,
        providerId: provider.addonId,
        id: `${provider.addonId}:news.fr`,
        remoteId: 'news.fr',
      }],
    }, () => 1_000);

    const result = await service.load([{
      ...playlistProvider,
      addonId: 'org.example.tv',
      manifestUrl: 'https://example.tv/manifest.json',
      kind: 'addon',
    }]);

    expect(result.channels[0]?.variants[0]?.channel)
      .not.toHaveProperty('directStreamUrl');
  });

  it('drops a playlist channel URL that is not playable', async () => {
    const service = new LiveTvChannelService({
      listChannels: async (provider) => [{
        ...playlistChannel,
        providerId: provider.addonId,
        directStreamUrl: 'https://user:secret@host.example/live/12.ts',
      }],
    }, () => 1_000);

    const result = await service.load([playlistProvider]);

    expect(result.channels[0]?.variants[0]?.channel)
      .not.toHaveProperty('directStreamUrl');
  });
});
